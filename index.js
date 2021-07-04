const EventEmitter = require('events')

const NOT_READABLE = defaultImpl(new Error('Not readable'))
const NOT_WRITABLE = defaultImpl(new Error('Not writable'))
const NOT_DELETABLE = defaultImpl(new Error('Not deletable'))
const NOT_STATABLE = defaultImpl(new Error('Not statable'))
const NO_OPEN_READABLE = defaultImpl(new Error('No readonly open'))

// NON_BLOCKING_OPS
const READ_OP = 0
const WRITE_OP = 1
const DEL_OP = 2
const STAT_OP = 3

// BLOCKING_OPS
const OPEN_OP = 4
const CLOSE_OP = 5
const DESTROY_OP = 6

const noop = () => {}

class RandomAccess extends EventEmitter {
  /**
   * @param {{
   *   read?: any;
   *   write?: any;
   *   del?: any;
   *   stat?: any;
   *   open?: any;
   *   close?: any;
   *   destroy?: any;
   *   openReadonly?: any;
   * }} [options]
   */
  constructor (options = {}) {
    super()

    this._queued = []
    this._pending = 0
    this._needsOpen = true

    this.opened = false
    this.closed = false
    this.destroyed = false

    if (options.openReadonly) this._openReadonly = options.openReadonly
    if (options.open) this._open = options.open
    if (options.read) this._read = options.read
    if (options.write) this._write = options.write
    if (options.del) this._del = options.del
    if (options.stat) this._stat = options.stat
    if (options.close) this._close = options.close
    if (options.destroy) this._destroy = options.destroy

    this.preferReadonly = this._openReadonly !== NO_OPEN_READABLE
    this.readable = this._read !== NOT_READABLE
    this.writable = this._write !== NOT_WRITABLE
    this.deletable = this._del !== NOT_DELETABLE
    this.statable = this._stat !== NOT_STATABLE
  }

  /**
   * @param {number} offset
   * @param {number} size
   */
  read (offset, size, cb) {
    this.run(new Request(this, READ_OP, offset, size, null, cb))
  }

  /**
   * @param {number} offset
   * @param {any} data
   */
  write (offset, data, cb = noop) {
    openWritable(this)
    this.run(new Request(this, WRITE_OP, offset, data.length, data, cb))
  }

  /**
   * @param {number} offset
   * @param {number} size
   */
  del (offset, size, cb = noop) {
    openWritable(this)
    this.run(new Request(this, DEL_OP, offset, size, null, cb))
  }

  stat (cb) {
    this.run(new Request(this, STAT_OP, 0, 0, null, cb))
  }

  open (cb = noop) {
    if (this.opened && !this._needsOpen) return process.nextTick(cb, null)
    queueAndRun(this, new Request(this, OPEN_OP, 0, 0, null, cb))
  }

  close (cb = noop) {
    if (this.closed) return process.nextTick(cb, null)
    queueAndRun(this, new Request(this, CLOSE_OP, 0, 0, null, cb))
  }

  destroy (cb = noop) {
    if (!this.closed) this.close(noop)
    queueAndRun(this, new Request(this, DESTROY_OP, 0, 0, null, cb))
  }

  /** @param {Request} req */
  run (req) {
    if (this._needsOpen) this.open(noop)
    if (this._queued.length) this._queued.push(req)
    else req._run()
  }
}

RandomAccess.prototype._read = NOT_READABLE
RandomAccess.prototype._write = NOT_WRITABLE
RandomAccess.prototype._del = NOT_DELETABLE
RandomAccess.prototype._stat = NOT_STATABLE
RandomAccess.prototype._open = defaultImpl(null)
RandomAccess.prototype._openReadonly = NO_OPEN_READABLE
RandomAccess.prototype._close = defaultImpl(null)
RandomAccess.prototype._destroy = defaultImpl(null)

class Request {
  /**
   * @param {RandomAccess} randomAccess
   * @param {number} type
   * @param {number} offset
   * @param {number} size
   * @param {any} data
   * @param {any} cb
   */
  constructor (randomAccess, type, offset, size, data, cb) {
    this.type = type
    this.offset = offset
    this.data = data
    this.size = size
    this.storage = randomAccess

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
    if (ra.preferReadonly) ra._openReadonly(this)
    else ra._open(this)
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

/** @param {RandomAccess} self */
function drainQueue (self) {
  const queued = self._queued

  while (queued.length > 0) {
    const blocking = queued[0].type > 3
    if (!blocking || !self._pending) queued[0]._run()
    if (blocking) return
    queued.shift()
  }
}

/** @param {RandomAccess} self */
function openWritable (self) {
  if (self.preferReadonly) {
    self._needsOpen = true
    self.preferReadonly = false
  }
}

function defaultImpl (err) {
  return overridable

  function overridable (req) {
    nextTick(req, err)
  }
}

/** @param {Error} err */
function nextTick (req, err, val) {
  process.nextTick(nextTickCallback, req, err, val)
}

function nextTickCallback (req, err, val) {
  req.callback(err, val)
}

module.exports = RandomAccess
