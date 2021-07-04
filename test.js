const tape = require('tape')
const Ras = require('./index.js')

tape('basic read', t => {
  t.plan(2 * 4 + 4)

  const expected = [Buffer.from('hi'), Buffer.from('ho')]
  const queued = expected.slice(0)
  const s = new Ras({
    read (req) {
      process.nextTick(() => {
        t.same(req.offset, 0)
        t.same(req.size, 2)
        req.callback(null, queued.shift())
      })
    }
  })

  t.ok(s.readable)
  t.notOk(s.writable)
  t.notOk(s.deletable)
  t.notOk(s.statable)
  s.read(0, 2, ondata)
  s.read(0, 2, ondata)

  function ondata (err, data) {
    t.error(err, 'no error')
    t.same(data, expected.shift())
  }
})

tape('basic write', t => {
  t.plan(2 * 2 + 4)

  const expected = [Buffer.from('hi'), Buffer.from('ho')]
  const s = new Ras({
    write (req) {
      t.same(req.data, expected.shift())
      req.callback(null)
    }
  })

  t.notOk(s.readable)
  t.ok(s.writable)
  t.notOk(s.deletable)
  t.notOk(s.statable)
  s.write(0, Buffer.from('hi'), onwrite)
  s.write(0, Buffer.from('ho'), onwrite)

  function onwrite (err, write) {
    t.error(err, 'no error')
  }
})

tape('basic del', t => {
  t.plan(2 + 2 * 3 + 4)

  const s = new Ras({
    del (req) {
      t.same(req.offset, 0)
      t.same(req.size, 2)
      req.callback(null)
    }
  })

  t.notOk(s.readable)
  t.notOk(s.writable)
  t.ok(s.deletable)
  t.notOk(s.statable)
  s.del(0, 2, ondelete)
  s.del(0, 2, ondelete)
  s.del(0, 2) // cb is optional

  function ondelete (err) {
    t.error(err, 'no error')
  }
})

tape('basic stat', t => {
  t.plan(2 * 2 + 4)

  const s = new Ras({
    stat (req) {
      req.callback(null, { size: 42 })
    }
  })

  t.notOk(s.readable)
  t.notOk(s.writable)
  t.notOk(s.deletable)
  t.ok(s.statable)
  s.stat(onstat)
  s.stat(onstat)

  function onstat (err, st) {
    t.error(err, 'no error')
    t.same(st, { size: 42 })
  }
})

tape('no opts', t => {
  const s = new Ras()

  t.notOk(s.readable)
  t.notOk(s.writable)
  t.notOk(s.deletable)
  t.notOk(s.statable)
  t.end()
})

tape('many open calls only trigger one _open', t => {
  t.plan(1)

  const s = new Ras({
    open (req) {
      process.nextTick(() => {
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

tape('open errors', t => {
  t.plan(3 + 2)

  const s = new Ras({
    open (req) {
      t.pass('in open')
      setImmediate(() => req.callback(new Error('nope')))
    },
    write (req) {
      t.fail('should not get here')
      req.callback(null)
    }
  })

  s.write(0, Buffer.from('hi'), onwrite)
  s.write(0, Buffer.from('hi'), onwrite)
  s.write(0, Buffer.from('hi'), onwrite)
  s.open() // should try and open again

  function onwrite (err) {
    t.same(err, new Error('Not opened'))
  }
})

tape('open before read', t => {
  t.plan(5 * 2 + 1 + 1)

  let open = false
  const s = new Ras({
    open (req) {
      t.ok(!open, 'only open once')
      open = true
      req.callback(null)
    },
    read (req) {
      t.ok(open, 'is open')
      req.callback(null, Buffer.from('hi'))
    }
  })

  t.notOk(s.opened, 'opened property not set')
  s.read(0, 2, ondata)
  s.read(0, 2, ondata)

  function ondata (err, data) {
    t.error(err, 'no error')
    t.ok(open, 'is open')
    t.ok(s.opened, 'opened property set')
    t.same(data, Buffer.from('hi'))
  }
})

tape('close', t => {
  t.plan(7)

  const s = new Ras({
    close (req) {
      t.pass('closing')
      req.callback(null)
    }
  })

  s.on('close', () => t.pass('close emitted'))
  s.open()
  s.close()
  s.close()
  s.close(() => {
    t.pass('calls the callback')
  })

  s.read(0, 10, err => t.same(err, new Error('Closed')))
  s.stat(err => t.same(err, new Error('Closed')))
  s.write(0, Buffer.from('hi'), err => t.same(err, new Error('Closed')))
  s.del(0, 10, err => t.same(err, new Error('Closed')))
})

tape('close, no open', t => {
  t.plan(5)

  const s = new Ras({
    close: req => t.fail('only close if open')
  })

  s.close()
  s.close()
  s.close(() => {
    t.pass('calls the callback')
  })

  s.read(0, 10, err => t.same(err, new Error('Closed')))
  s.stat(err => t.same(err, new Error('Closed')))
  s.write(0, Buffer.from('hi'), err => t.same(err, new Error('Closed')))
  s.del(0, 10, err => t.same(err, new Error('Closed')))
})

tape('destroy', t => {
  t.plan(4)

  const s = new Ras({
    open: req => t.fail('no open'),
    destroy (req) {
      t.pass('destroying')
      req.callback(null)
    }
  })

  s.on('destroy', () => t.pass('destroy emitted'))
  s.destroy()
  s.destroy(err => {
    t.error(err, 'no error')
    t.pass('calls the callback')
  })
})

tape('destroy closes first', t => {
  t.plan(2)

  const s = new Ras({
    close (req) {
      t.pass('closing')
      req.callback(null)
    },
    destroy (req) {
      t.ok(s.closed, 'is closed')
      req.callback(null)
    }
  })

  s.open()
  s.destroy()
})

tape('destroy with explicit close first', t => {
  t.plan(2)

  const s = new Ras({
    close (req) {
      t.pass('closing')
      req.callback(null)
    },
    destroy (req) {
      t.ok(s.closed, 'is closed')
      req.callback(null)
    }
  })

  s.open()
  s.close()
  s.destroy()
})

tape('open and close', t => {
  t.plan(7)

  const s = new Ras({
    open (req) {
      t.pass('opening')
      req.callback(null)
    },
    close (req) {
      t.pass('closing')
      req.callback(null)
    }
  })

  s.open()
  s.close()
  s.close()
  s.close(() => {
    t.pass('calls the callback')
  })

  s.read(0, 10, err => t.same(err, new Error('Closed')))
  s.stat(err => t.same(err, new Error('Closed')))
  s.write(0, Buffer.from('hi'), err => t.same(err, new Error('Closed')))
  s.del(0, 10, err => t.same(err, new Error('Closed')))
})

tape('write and close', t => {
  t.plan(1 + 5 + 1 + 3)

  let closed = false
  const s = new Ras({
    open (req) {
      t.pass('opened')
      req.callback(null)
    },
    write (req) {
      t.pass('in write')
      process.nextTick(() => {
        req.callback(null)
      })
    },
    close (req) {
      t.notOk(closed, 'not closed yet')
      closed = true
      req.callback(null)
    }
  })

  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.write(0, Buffer.from('hi'))
  s.close(err => t.error(err, 'no error'))
  s.close(err => t.error(err, 'no error'))
  s.close(err => t.error(err, 'no error'))
})

tape('open readonly', t => {
  t.plan(2)

  const s = new Ras({
    open: () => t.fail('no open'),
    openReadonly (req) {
      t.pass('open readonly')
      req.callback(null)
    },
    read: req => req.callback(null, Buffer.from('hi'))
  })

  s.open()
  s.read(0, 10, err => t.error(err, 'no error'))
})

tape('open readonly and then write', t => {
  t.plan(4)

  let readonlyFirst = true

  const s = new Ras({
    open (req) {
      t.notOk(readonlyFirst, 'open readonly first')
      req.callback(null)
    },
    openReadonly (req) {
      t.ok(readonlyFirst, 'open readonly first')
      readonlyFirst = false
      req.callback(null)
    },
    read: req => req.callback(null, Buffer.from('hi')),
    write: req => req.callback(null)
  })

  s.open()
  s.read(0, 2, err => t.error(err, 'no error'))
  s.write(0, Buffer.from('hi'), err => t.error(err, 'no error'))
})

tape('open readonly ignored when first op is write', t => {
  t.plan(3)

  const s = new Ras({
    open (req) {
      t.pass('should open')
      req.callback(null)
    },
    openReadonly: req => t.fail('first op is a write'),
    read: req => req.callback(null, Buffer.from('hi')),
    write: req => req.callback(null)
  })

  s.write(0, Buffer.from('hi'), err => t.error(err, 'no error'))
  s.read(0, 2, err => t.error(err, 'no error'))
})

tape('always async', t => {
  const s = new Ras({
    read: req => req.callback(null, Buffer.from('hi'))
  })

  s.open(() => {
    let sync = true

    s.read(0, 2, (err, buf) => {
      t.error(err, 'no error')
      t.same(buf, Buffer.from('hi'))
      t.notOk(sync)
      t.end()
    })

    sync = false
  })
})

tape('open error forwarded to dependents', t => {
  const s = new Ras({
    open: req => req.callback(new Error('Nope')),
    read: req => req.callback(null, Buffer.from('hi')),
    write: req => req.callback(null, null)
  })

  s.write(0, Buffer.from('hi'), err => {
    t.ok(err)
    t.same(err.message, 'Nope')
  })

  s.read(0, 2, err => {
    t.ok(err)
    t.same(err.message, 'Nope')
  })

  s.close(err => {
    t.ok(!err)
    t.end()
  })
})

tape('close immediately', t => {
  t.plan(11)

  let closed = false
  const s = new Ras({
    read (req) {
      setImmediate(() => {
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
