const test = require('brittle')
const RAS = require('.')

test('basic read', function (t) {
  t.plan(2 * 4 + 4)

  const expected = [Buffer.from('hi'), Buffer.from('ho')]
  const queued = expected.slice(0)
  const s = new RAS({
    read: function (req) {
      process.nextTick(function () {
        t.alike(req.offset, 0)
        t.alike(req.size, 2)
        req.callback(null, queued.shift())
      })
    }
  })

  t.ok(s.readable)
  t.absent(s.writable)
  t.absent(s.deletable)
  t.absent(s.statable)
  s.read(0, 2, ondata)
  s.read(0, 2, ondata)

  function ondata (err, data) {
    t.absent(err, 'no error')
    t.alike(data, expected.shift())
  }
})

test('basic write', function (t) {
  t.plan(2 * 2 + 4)

  const expected = [Buffer.from('hi'), Buffer.from('ho')]
  const s = new RAS({
    write: function (req) {
      t.alike(req.data, expected.shift())
      req.callback(null)
    }
  })

  t.absent(s.readable)
  t.ok(s.writable)
  t.absent(s.deletable)
  t.absent(s.statable)
  s.write(0, Buffer.from('hi'), onwrite)
  s.write(0, Buffer.from('ho'), onwrite)

  function onwrite (err, write) {
    t.absent(err, 'no error')
  }
})

test('basic del', function (t) {
  t.plan(2 + 2 * 3 + 4)

  const s = new RAS({
    del: function (req) {
      t.alike(req.offset, 0)
      t.alike(req.size, 2)
      req.callback(null)
    }
  })

  t.absent(s.readable)
  t.absent(s.writable)
  t.ok(s.deletable)
  t.absent(s.statable)
  s.del(0, 2, ondelete)
  s.del(0, 2, ondelete)
  s.del(0, 2) // cb is optional

  function ondelete (err) {
    t.absent(err, 'no error')
  }
})

test('basic stat', function (t) {
  t.plan(2 * 2 + 4)

  const s = new RAS({
    stat: function (req) {
      req.callback(null, { size: 42 })
    }
  })

  t.absent(s.readable)
  t.absent(s.writable)
  t.absent(s.deletable)
  t.ok(s.statable)
  s.stat(onstat)
  s.stat(onstat)

  function onstat (err, st) {
    t.absent(err, 'no error')
    t.alike(st, { size: 42 })
  }
})

test('no opts', function (t) {
  const s = new RAS()

  t.absent(s.readable)
  t.absent(s.writable)
  t.absent(s.deletable)
  t.absent(s.statable)
})

test('many open calls only trigger one _open', function (t) {
  t.plan(1)

  const s = new RAS({
    open: function (req) {
      process.nextTick(function () {
        t.pass('is opening')
        req.callback(null)
      })
    }
  })

  s.open()
  s.open()
  s.open()
  s.open()
  s.open()
  setImmediate(() => s.open())
})

test('open errors', function (t) {
  t.plan(3 + 2)

  const s = new RAS({
    open: function (req) {
      t.pass('in open')
      setImmediate(() => req.callback(new Error('nope')))
    },
    write: function (req) {
      t.fail('should not get here')
      req.callback(null)
    }
  })

  s.write(0, Buffer.from('hi'), onwrite)
  s.write(0, Buffer.from('hi'), onwrite)
  s.write(0, Buffer.from('hi'), onwrite)
  s.open() // should try and open again

  function onwrite (err) {
    t.alike(err, new Error('nope'))
  }
})

test('open before read', function (t) {
  t.plan(5 * 2 + 1 + 1)

  let open = false
  const s = new RAS({
    open: function (req) {
      t.ok(!open, 'only open once')
      open = true
      req.callback(null)
    },
    read: function (req) {
      t.ok(open, 'is open')
      req.callback(null, Buffer.from('hi'))
    }
  })

  t.absent(s.opened, 'opened property not set')
  s.read(0, 2, ondata)
  s.read(0, 2, ondata)

  function ondata (err, data) {
    t.absent(err, 'no error')
    t.ok(open, 'is open')
    t.ok(s.opened, 'opened property set')
    t.alike(data, Buffer.from('hi'))
  }
})

test('close', function (t) {
  t.plan(7)

  const s = new RAS({
    close: function (req) {
      t.pass('closing')
      req.callback(null)
    }
  })

  s.on('close', () => t.pass('close emitted'))
  s.open()
  s.close()
  s.close()
  s.close(function () {
    t.pass('calls the callback')
  })

  s.read(0, 10, err => t.alike(err, new Error('Closed')))
  s.stat(err => t.alike(err, new Error('Closed')))
  s.write(0, Buffer.from('hi'), err => t.alike(err, new Error('Closed')))
  s.del(0, 10, err => t.alike(err, new Error('Closed')))
})

test('close, no open', function (t) {
  t.plan(5)

  const s = new RAS({
    close: req => t.fail('only close if open')
  })

  s.close()
  s.close()
  s.close(function () {
    t.pass('calls the callback')
  })

  s.read(0, 10, err => t.alike(err, new Error('Closed')))
  s.stat(err => t.alike(err, new Error('Closed')))
  s.write(0, Buffer.from('hi'), err => t.alike(err, new Error('Closed')))
  s.del(0, 10, err => t.alike(err, new Error('Closed')))
})

test('destroy', function (t) {
  t.plan(4)

  const s = new RAS({
    open: req => t.fail('no open'),
    destroy: function (req) {
      t.pass('destroying')
      req.callback(null)
    }
  })

  s.on('destroy', () => t.pass('destroy emitted'))
  s.destroy()
  s.destroy(function (err) {
    t.absent(err, 'no error')
    t.pass('calls the callback')
  })
})

test('destroy closes first', function (t) {
  t.plan(2)

  const s = new RAS({
    close: function (req) {
      t.pass('closing')
      req.callback(null)
    },
    destroy: function (req) {
      t.ok(s.closed, 'is closed')
      req.callback(null)
    }
  })

  s.open()
  s.destroy()
})

test('destroy with explicit close first', function (t) {
  t.plan(2)

  const s = new RAS({
    close: function (req) {
      t.pass('closing')
      req.callback(null)
    },
    destroy: function (req) {
      t.ok(s.closed, 'is closed')
      req.callback(null)
    }
  })

  s.open()
  s.close()
  s.destroy()
})

test('open and close', function (t) {
  t.plan(7)

  const s = new RAS({
    open: function (req) {
      t.pass('opening')
      req.callback(null)
    },
    close: function (req) {
      t.pass('closing')
      req.callback(null)
    }
  })

  s.open()
  s.close()
  s.close()
  s.close(function () {
    t.pass('calls the callback')
  })

  s.read(0, 10, err => t.alike(err, new Error('Closed')))
  s.stat(err => t.alike(err, new Error('Closed')))
  s.write(0, Buffer.from('hi'), err => t.alike(err, new Error('Closed')))
  s.del(0, 10, err => t.alike(err, new Error('Closed')))
})

test('write and close', function (t) {
  t.plan(1 + 5 + 1 + 3)

  let closed = false
  const s = new RAS({
    open: function (req) {
      t.pass('opened')
      req.callback(null)
    },
    write: function (req) {
      t.pass('in write')
      process.nextTick(function () {
        req.callback(null)
      })
    },
    close: function (req) {
      t.absent(closed, 'not closed yet')
      closed = true
      req.callback(null)
    }
  })

  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.close(err => t.absent(err, 'no error'))
  s.close(err => t.absent(err, 'no error'))
  s.close(err => t.absent(err, 'no error'))
})

test('open and read', function (t) {
  t.plan(2)

  const s = new RAS({
    open: function (req) {
      t.not(req.create, 'no create')
      req.callback(null)
    },
    read: req => req.callback(null, Buffer.from('hi'))
  })

  s.open()
  s.read(0, 10, err => t.absent(err, 'no error'))
})

test('open and read then write', function (t) {
  t.plan(4)

  let first = true

  const s = new RAS({
    open: function (req) {
      if (first) t.not(req.create, 'no create')
      else t.ok(req.create, 'create')

      first = false
      req.callback(null)
    },
    read: req => req.callback(null, Buffer.from('hi')),
    write: req => req.callback(null)
  })

  s.open()
  s.read(0, 2, err => t.absent(err, 'no error'))
  s.write(0, Buffer.from('hi'), err => t.absent(err, 'no error'))
})

test('open and write', function (t) {
  t.plan(3)

  const s = new RAS({
    open: function (req) {
      t.ok(req.create, 'create')
      req.callback(null)
    },
    read: req => req.callback(null, Buffer.from('hi')),
    write: req => req.callback(null)
  })

  s.write(0, Buffer.from('hi'), err => t.absent(err, 'no error'))
  s.read(0, 2, err => t.absent(err, 'no error'))
})

test('always async', function (t) {
  t.plan(3)

  const s = new RAS({
    read: req => req.callback(null, Buffer.from('hi'))
  })

  s.open(function () {
    let sync = true

    s.read(0, 2, function (err, buf) {
      t.absent(err, 'no error')
      t.alike(buf, Buffer.from('hi'))
      t.absent(sync)
    })

    sync = false
  })
})

test('open error forwarded to dependents', function (t) {
  t.plan(5)

  const s = new RAS({
    open: req => req.callback(new Error('Nope')),
    read: req => req.callback(null, Buffer.from('hi')),
    write: req => req.callback(null, null)
  })

  s.write(0, Buffer.from('hi'), function (err) {
    t.ok(err)
    t.alike(err.message, 'Nope')
  })

  s.read(0, 2, function (err) {
    t.ok(err)
    t.alike(err.message, 'Nope')
  })

  s.close(function (err) {
    t.ok(!err)
  })
})

test('close immediately', function (t) {
  t.plan(11)

  let closed = false
  const s = new RAS({
    read (req) {
      setImmediate(function () {
        t.ok(!closed)
        req.callback(null, Buffer.alloc(1))
      })
    },
    close (req) {
      closed = true
      t.pass('closed')
      req.callback()
    }
  })

  for (let i = 0; i < 10; i++) s.read(0, 1, () => {})
  s.close()
})

test('class extend', function (t) {
  class C extends RAS {
    _read (req) {
      req.callback(null)
    }

    _write (req) {
      req.callback(null)
    }

    _del (req) {
      req.callback(null)
    }

    _stat (req) {
      req.callback(null)
    }
  }

  const c = new C()

  t.ok(c.readable)
  t.ok(c.writable)
  t.ok(c.deletable)
  t.ok(c.statable)
})

test('create always', function (t) {
  t.plan(1)

  const s = new RAS({
    createAlways: true,

    open: function (req) {
      t.ok(req.create)
      req.callback(null)
    }
  })

  s.open()
})
