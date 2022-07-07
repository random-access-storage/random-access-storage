const EventEmitter = require('events')
const queueTick = require('queue-tick')

const NOT_READABLE = defaultImpl(new Error('Not readable'))
const NOT_WRITABLE = defaultImpl(new Error('Not writable'))
const NOT_DELETABLE = defaultImpl(new Error('Not deletable'))
const NOT_STATABLE = defaultImpl(new Error('Not statable'))

const DEFAULT_OPEN = defaultImpl(null)
const DEFAULT_CLOSE = defaultImpl(null)
const DEFAULT_DESTROY = defaultImpl(null)

// NON_BLOCKING_OPS
const READ_OP = 0
const WRITE_OP = 1
const DEL_OP = 2
const STAT_OP = 3

// BLOCKING_OPS
const OPEN_OP = 4
const CLOSE_OP = 5
const DESTROY_OP = 6

module.exports = class RandomAccessStorage extends EventEmitter {
  constructor (opts = {}) {
    super()

    this._queued = []
    this._pending = 0
    this._needsOpen = true
    this._needsCreate = !!opts.createAlways

    this.opened = false
    this.closed = false
    this.destroyed = false

    if (opts.open) this._open = opts.open
    if (opts.read) this._read = opts.read
    if (opts.write) this._write = opts.write
    if (opts.del) this._del = opts.del
    if (opts.stat) this._stat = opts.stat
    if (opts.close) this._close = opts.close
    if (opts.destroy) this._destroy = opts.destroy

    this.readable = this._read !== RandomAccessStorage.prototype._read
    this.writable = this._write !== RandomAccessStorage.prototype._write
    this.deletable = this._del !== RandomAccessStorage.prototype._del
    this.statable = this._stat !== RandomAccessStorage.prototype._stat
  }

  read (offset, size, cb) {
    this.run(new Request(this, READ_OP, offset, size, null, false, cb))
  }

  _read (req) {
    return NOT_READABLE(req)
  }

  write (offset, data, cb) {
    if (!cb) cb = noop
    openWritable(this)
    this.run(new Request(this, WRITE_OP, offset, data.length, data, false, cb))
  }

  _write (req) {
    return NOT_WRITABLE(req)
  }

  del (offset, size, cb) {
    if (!cb) cb = noop
    openWritable(this)
    this.run(new Request(this, DEL_OP, offset, size, null, false, cb))
  }

  _del (req) {
    return NOT_DELETABLE(req)
  }

  stat (cb) {
    this.run(new Request(this, STAT_OP, 0, 0, null, false, cb))
  }

  _stat (req) {
    return NOT_STATABLE(req)
  }

  open (cb) {
    if (!cb) cb = noop
    if (this.opened && !this._needsOpen) return queueTick(() => cb(null))
    queueAndRun(this, new Request(this, OPEN_OP, 0, 0, null, this._needsCreate, cb))
  }

  _open (req) {
    return DEFAULT_OPEN(req)
  }

  close (cb) {
    if (!cb) cb = noop
    if (this.closed) return queueTick(() => cb(null))
    queueAndRun(this, new Request(this, CLOSE_OP, 0, 0, null, false, cb))
  }

  _close (req) {
    return DEFAULT_CLOSE(req)
  }

  destroy (cb) {
    if (!cb) cb = noop
    if (!this.closed) this.close(noop)
    queueAndRun(this, new Request(this, DESTROY_OP, 0, 0, null, false, cb))
  }

  _destroy (req) {
    return DEFAULT_DESTROY(req)
  }

  run (req) {
    if (this._needsOpen) this.open(noop)
    if (this._queued.length) this._queued.push(req)
    else req._run()
  }
}

function noop () {}

class Request {
  constructor (self, type, offset, size, data, create, cb) {
    this.type = type
    this.offset = offset
    this.size = size
    this.data = data
    this.create = create
    this.storage = self

    this._sync = false
    this._callback = cb
    this._openError = null
  }

  _maybeOpenError (err) {
    if (this.type !== OPEN_OP) return
    const queued = this.storage._queued
    for (let i = 0; i < queued.length; i++) queued[i]._openError = err
  }

  _unqueue (err) {
    const ra = this.storage
    const queued = ra._queued

    if (!err) {
      switch (this.type) {
        case OPEN_OP:
          if (!ra.opened) {
            ra.opened = true
            ra.emit('open')
          }
          break

        case CLOSE_OP:
          if (!ra.closed) {
            ra.closed = true
            ra.emit('close')
          }
          break

        case DESTROY_OP:
          if (!ra.destroyed) {
            ra.destroyed = true
            ra.emit('destroy')
          }
          break
      }
    } else {
      this._maybeOpenError(err)
    }

    if (queued.length && queued[0] === this) queued.shift()

    if (!--ra._pending) drainQueue(ra)
  }

  callback (err, val) {
    if (this._sync) return nextTick(this, err, val)
    this._unqueue(err)
    this._callback(err, val)
  }

  _openAndNotClosed () {
    const ra = this.storage
    if (ra.opened && !ra.closed) return true
    if (!ra.opened) nextTick(this, this._openError || new Error('Not opened'))
    else if (ra.closed) nextTick(this, new Error('Closed'))
    return false
  }

  _open () {
    const ra = this.storage

    if (ra.opened && !ra._needsOpen) return nextTick(this, null)
    if (ra.closed) return nextTick(this, new Error('Closed'))

    ra._needsOpen = false
    ra._open(this)
  }

  _run () {
    const ra = this.storage
    ra._pending++

    this._sync = true

    switch (this.type) {
      case READ_OP:
        if (this._openAndNotClosed()) ra._read(this)
        break

      case WRITE_OP:
        if (this._openAndNotClosed()) ra._write(this)
        break

      case DEL_OP:
        if (this._openAndNotClosed()) ra._del(this)
        break

      case STAT_OP:
        if (this._openAndNotClosed()) ra._stat(this)
        break

      case OPEN_OP:
        this._open()
        break

      case CLOSE_OP:
        if (ra.closed || !ra.opened) nextTick(this, null)
        else ra._close(this)
        break

      case DESTROY_OP:
        if (ra.destroyed) nextTick(this, null)
        else ra._destroy(this)
        break
    }

    this._sync = false
  }
}

function queueAndRun (self, req) {
  self._queued.push(req)
  if (!self._pending) req._run()
}

function drainQueue (self) {
  const queued = self._queued

  while (queued.length > 0) {
    const blocking = queued[0].type > 3
    if (!blocking || !self._pending) queued[0]._run()
    if (blocking) return
    queued.shift()
  }
}

function openWritable (self) {
  if (!self._needsCreate) {
    self._needsOpen = true
    self._needsCreate = true
  }
}

function defaultImpl (err) {
  return overridable

  function overridable (req) {
    nextTick(req, err)
  }
}

function nextTick (req, err, val) {
  queueTick(() => req.callback(err, val))
}
