var tape = require('tape')
var ras = require('./')

tape('basic', function (t) {
  t.plan(4)

  var s = ras({
    read: req => req.callback(null, Buffer.from('hi'))
  })

  s.read(0, 2, function (err, data) {
    t.error(err, 'no error')
    t.same(data, Buffer.from('hi'))
  })

  s.read(0, 2, function (err, data) {
    t.error(err, 'no error')
    t.same(data, Buffer.from('hi'))
  })
})
