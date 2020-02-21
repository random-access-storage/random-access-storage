var events = require('events')
var inherits = require('inherits')

var NOT_READABLE = defaultImpl(new Error('Not readable'))
var NOT_WRITABLE = defaultImpl(new Error('Not writable'))
var NOT_DELETABLE = defaultImpl(new Error('Not deletable'))
var NOT_STATABLE = defaultImpl(new Error('Not statable'))
var NO_OPEN_READABLE = defaultImpl(new Error('No readonly open'))

module.exports = RandomAccess

function RandomAccess (opts) {
  if (!(this instanceof RandomAccess)) return new RandomAccess(opts)
  events.EventEmitter.call(this)

  this._queued = []
  this._pending = 0
  // Indicates whether open needs to be performed. Once `_open` is run is set
  // to `false`. However it might still can be `true` even after open succeeds,
  // e.g. if write is performed when it was open in read-only mode.
  this._needsOpen = true

  this.opened = false
  this.closed = false
  this.destroyed = false

  if (opts) {
    if (opts.openReadonly) this._openReadonly = opts.openReadonly
    if (opts.open) this._open = opts.open
    if (opts.reopen) this._reopen = opts.reopen
    if (opts.read) this._read = opts.read
    if (opts.write) this._write = opts.write
    if (opts.del) this._del = opts.del
    if (opts.stat) this._stat = opts.stat
    if (opts.close) this._close = opts.close
    if (opts.destroy) this._destroy = opts.destroy
  }

  this.preferReadonly = this._openReadonly !== NO_OPEN_READABLE
  this.readable = this._read !== NOT_READABLE
  this.writable = this._write !== NOT_WRITABLE
  this.deletable = this._del !== NOT_DELETABLE
  this.statable = this._stat !== NOT_STATABLE
}

inherits(RandomAccess, events.EventEmitter)

// Following operations (read, write, del, stat) are non-blocking, meaning they
// do not need get queued unless blocking operation is pending. If blocking
// operation is pending then they get scheduled to run after.
RandomAccess.prototype.read = function (offset, size, cb) {
  this.run(new Request(this, 0, offset, size, null, cb))
}

RandomAccess.prototype._read = NOT_READABLE

RandomAccess.prototype.write = function (offset, data, cb) {
  if (!cb) cb = noop
  openWritable(this)
  this.run(new Request(this, 1, offset, data.length, data, cb))
}

RandomAccess.prototype._write = NOT_WRITABLE

RandomAccess.prototype.del = function (offset, size, cb) {
  if (!cb) cb = noop
  openWritable(this)
  this.run(new Request(this, 2, offset, size, null, cb))
}

RandomAccess.prototype._del = NOT_DELETABLE

RandomAccess.prototype.stat = function (cb) {
  this.run(new Request(this, 3, 0, 0, null, cb))
}

RandomAccess.prototype._stat = NOT_STATABLE

// Following operations (open, close) are blocking, meaning operations will
// get queued to run after blocking operation is complete.

// Schedules open after all currently pending and queued operations. That is
// unless it is already open and no reopenening is required (which may occur
// e.g. when open in readonly mode, but read/write mode is needed). If later
// just succeeds.
RandomAccess.prototype.open = function (cb) {
  if (!cb) cb = noop
  if (this.opened && !this._needsOpen) return process.nextTick(cb, null)
  queueAndRun(this, new Request(this, 4, 0, 0, null, cb))
}

RandomAccess.prototype._open = defaultImpl(null)
RandomAccess.prototype._openReadonly = NO_OPEN_READABLE

// Scheduled close after all currently pending and queued operations, unless
// it's already closed.
RandomAccess.prototype.close = function (cb) {
  if (!cb) cb = noop
  if (this.closed) return process.nextTick(cb, null)
  queueAndRun(this, new Request(this, 5, 0, 0, null, cb))
}

RandomAccess.prototype._close = defaultImpl(null)

// Schedules destroy after all currently pending and queued operations. Also
// takes care of scheduling close unless already closed.
RandomAccess.prototype.destroy = function (cb) {
  if (!cb) cb = noop
  if (!this.closed) this.close(noop)
  queueAndRun(this, new Request(this, 6, 0, 0, null, cb))
}

RandomAccess.prototype._destroy = defaultImpl(null)

// Queues request if blocking operation is pending, otherwise runs it. If
// opening is required (e.g. not open yet, or write is performed while open in
// read-only mode) open is arranged first.
RandomAccess.prototype.run = function (req) {
  if (this._needsOpen) this.open(noop)
  else if (this.closed && this._reopen) this.open(noop)
  if (this._queued.length) this._queued.push(req)
  else req._run()
}

function noop () {}

function Request (self, type, offset, size, data, cb) {
  this.type = type
  this.offset = offset
  this.data = data
  this.size = size
  this.storage = self

  this._sync = false
  this._callback = cb
  this._openError = null
}

Request.prototype._maybeOpenError = function (err) {
  if (this.type !== 4) return
  var queued = this.storage._queued
  for (var i = 0; i < queued.length; i++) queued[i]._openError = err
}

Request.prototype._unqueue = function (err) {
  var ra = this.storage
  var queued = ra._queued

  if (!err) {
    switch (this.type) {
      case 4:
        if (!ra.opened) {
          ra.opened = true
          ra.closed = false
          ra.emit('open')
        }
        break

      case 5:
        if (!ra.closed) {
          ra.closed = true
          ra.opened = false
          ra.emit('close')
        }
        break

      case 6:
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

Request.prototype.callback = function (err, val) {
  if (this._sync) return nextTick(this, err, val)
  this._unqueue(err)
  this._callback(err, val)
}

Request.prototype._openAndNotClosed = function () {
  var ra = this.storage
  if (ra.opened && !ra.closed) return true
  if (!ra.opened) nextTick(this, this._openError || new Error('Not opened'))
  else if (ra.closed) nextTick(this, new Error('Closed'))
  return false
}

Request.prototype._open = function () {
  var ra = this.storage

  // Succeed if already open and no reopening is required.
  if (ra.opened && !ra._needsOpen) return nextTick(this, null)
  // Fail if already closed and reopening is not enabled.
  if (ra.closed && !ra._reopen) return nextTick(this, new Error('Closed'))

  // In all other cases perform open in appropriate mode.
  ra._needsOpen = false
  if (ra.preferReadonly) ra._openReadonly(this)
  else ra._open(this)
}

Request.prototype._run = function () {
  var ra = this.storage
  ra._pending++

  this._sync = true

  switch (this.type) {
    case 0:
      if (this._openAndNotClosed()) ra._read(this)
      break

    case 1:
      if (this._openAndNotClosed()) ra._write(this)
      break

    case 2:
      if (this._openAndNotClosed()) ra._del(this)
      break

    case 3:
      if (this._openAndNotClosed()) ra._stat(this)
      break

    case 4:
      this._open()
      break

    case 5:
      if (ra.closed || !ra.opened) nextTick(this, null)
      else ra._close(this)
      break

    case 6:
      if (ra.destroyed) nextTick(this, null)
      else ra._destroy(this)
      break
  }

  this._sync = false
}

// Schedules to run request after all currently pending requests.
function queueAndRun (self, req) {
  self._queued.push(req)
  if (!self._pending) req._run()
}

function drainQueue (self) {
  var queued = self._queued
  if (queued.length === 0) return

  // If closed when we start drainging the queue but reopen
  // mode is enabled reopen and then drain queue.
  if (self.closed && self._reopen) {
    const req = new Request(self, 4, 0, 0, null, noop)
    queued.unshift(req)
  }

  while (queued.length > 0) {
    queued[0]._run()
    if (queued[0].type > 3) return // all >3 types are blocking
    queued.shift()
  }
}

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

function nextTick (req, err, val) {
  process.nextTick(nextTickCallback, req, err, val)
}

function nextTickCallback (req, err, val) {
  req.callback(err, val)
}
