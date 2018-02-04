var NOT_READABLE = defaultImpl(new Error('Not readable'))
var NOT_WRITABLE = defaultImpl(new Error('Not writable'))
var NOT_DELETABLE = defaultImpl(new Error('Not deletable'))
var NOT_STATABLE = defaultImpl(new Error('Not statable'))

module.exports = RandomAccess

function RandomAccess (opts) {
  if (!(this instanceof RandomAccess)) return new RandomAccess(opts)

  this._queued = []
  this._pending = 0
  this._needsOpen = true

  this.opened = false
  this.closed = false
  this.lazyWritable = false

  if (opts) {
    if (opts.lazyWritable) this.lazyWritable = true
    if (opts.read) this._read = opts.read
    if (opts.write) this._write = opts.write
    if (opts.del) this._del = opts.del
    if (opts.stat) this._stat = opts.stat
  }

  this.readable = this._read !== NOT_READABLE
  this.writable = this._write !== NOT_WRITABLE
  this.deletable = this._del !== NOT_DELETABLE
  this.statable = this._stat !== NOT_STATABLE
}

RandomAccess.prototype.open = function (cb) {
  if (!cb) cb = noop
  if (this.opened && !this._needsOpen) return process.nextTick(cb, null)
  queueAndRun(this, new Request(this, 0, 0, 0, null, cb))
}

RandomAccess.prototype._open = defaultImpl(null)

RandomAccess.prototype.read = function (offset, size, cb) {
  runOrQueue(this, new Request(this, 1, offset, size, null, cb))
}

RandomAccess.prototype._read = NOT_READABLE

RandomAccess.prototype.write = function (offset, data, cb) {
  lazyWritable(this)
  runOrQueue(this, new Request(this, 2, offset, data.length, data, cb))
}

RandomAccess.prototype._write = NOT_WRITABLE

RandomAccess.prototype.del = function (offset, size, cb) {
  lazyWritable(this)
  runOrQueue(this, new Request(this, 3, offset, size, null, cb))
}

RandomAccess.prototype._del = NOT_DELETABLE

RandomAccess.prototype.stat = function (cb) {
  runOrQueue(this, new Request(this, 4, 0, 0, null, cb))
}

RandomAccess.prototype._stat = NOT_STATABLE

RandomAccess.prototype.close = function (cb) {
  if (!cb) cb = noop
  if (this.closed) return process.nextTick(cb, null)
  queueAndRun(this, new Request(this, 5, 0, 0, null, cb))
}

RandomAccess.prototype._close = defaultImpl(null)

function noop () {}

function Request (self, type, offset, size, data, cb) {
  this.type = type
  this.offset = offset
  this.data = data
  this.size = size
  this.randomAccess = self

  this._callback = cb
}

Request.prototype._unqueue = function (err) {
  var ra = this.randomAccess
  var queued = ra._queued

  if (this.type === 0) ra.opened = !err
  else if (this.type === 5) ra.closed = !err

  if (queued.length && queued[0] === this) queued.shift()
  if (!--ra._pending && queued.length) queued[0]._run()
}

Request.prototype.callback = function (err, val) {
  this._unqueue(err)
  this._callback(err, val)
}

Request.prototype._openAndNotClosed = function () {
  var ra = this.randomAccess
  if (ra.opened && !ra.closed) return true
  if (!ra.opened) nextTick(this, new Error('Not opened'))
  else if (ra.closed) nextTick(this, new Error('Closed'))
  return false
}

Request.prototype._run = function () {
  var ra = this.randomAccess
  ra._pending++

  switch (this.type) {
    case 0:
      if (ra.opened && !ra._needsOpen) return nextTick(this, null)
      if (ra.closed) return nextTick(this, new Error('Closed'))
      ra._needsOpen = false
      ra._open(this)
      break

    case 1:
      if (this._openAndNotClosed()) ra._read(this)
      break

    case 2:
      if (this._openAndNotClosed()) ra._write(this)
      break

    case 3:
      if (this._openAndNotClosed()) ra._del(this)
      break

    case 4:
      if (this._openAndNotClosed()) ra._stat(this)
      break

    case 5:
      if (ra.closed) return nextTick(this, null)
      ra._close(this)
      break
  }
}

function queueAndRun (self, req) {
  self._queued.push(req)
  if (!self._pending) req._run()
}

function lazyWritable (self) {
  if (self.lazyWritable) {
    self._needsOpen = true
    self.lazyWritable = false
  }
}

function runOrQueue (self, req) {
  if (self._needsOpen) self.open(noop)
  if (self._queued.length) self._queued.push(req)
  else req._run()
}

function defaultImpl (err) {
  return overridable

  function overridable (req) {
    nextTick(req, err)
  }
}

function nextTick (req, err) {
  process.nextTick(nextTickCallback, req, err)
}

function nextTickCallback (req, err) {
  req.callback(err, null)
}
