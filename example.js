const RandomAccess = require('./index.js')
const fs = require('fs')

const file = fileReader('index.js')

file.read(0, 10, (_, buf) => console.log(`0-10: ${buf.toString()}`))
file.read(40, 15, (_, buf) => console.log(`40-55: ${buf.toString()}`))
file.close()

function fileReader (name) {
  let fd = 0
  return new RandomAccess({
    open (req) {
      fs.open(name, 'r', (err, res) => {
        if (err) return req.callback(err)
        fd = res
        req.callback(null)
      })
    },
    read (req) {
      const buf = Buffer.allocUnsafe(req.size)
      fs.read(fd, buf, 0, buf.length, req.offset, (err, read) => {
        if (err) return req.callback(err)
        if (read < buf.length) return req.callback(new Error('Could not read'))
        req.callback(null, buf)
      })
    },
    close (req) {
      if (!fd) return req.callback(null)
      fs.close(fd, err => req.callback(err))
    }
  })
}
