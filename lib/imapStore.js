var Imap = require('imap')
var Message = require('./message')
var asynk = require('asynk')
var streamize = require('streamize')
var _ = require('lodash')

var STATE = {
  CLOSED: 0,
  CONNECTING: 1,
  CONNECTED: 3,
  LOGGED_IN: 4
}

var ImapStore = function () {
  this.status = null
  this.STATE = STATE
}

ImapStore.prototype.connect = function (callback) {
  var self = this
  this.IMAPClient = new Imap({
    user: self.login,
    password: self.password,
    host: self.host,
    port: self.port,
    tls: self.tls,
    autotls: 'always',
    tlsOptions: { rejectUnauthorized: false }
  })
  this.IMAPClient.once('error', function (err) {
    this.end()
    var cb = callback
    callback = function () {}
    cb(err, null)
  })
  this.IMAPClient.once('ready', function () {
    self.status = STATE.LOGGED_IN
    var cb = callback
    callback = function () {}
    cb(null, null)
  })
  this.IMAPClient.once('end', function () {
    self.status = STATE.CLOSED
  })
  this.IMAPClient.connect()
  this.status = STATE.CONNECTING
}

ImapStore.prototype.getMailboxes = function (callback) {
  var self = this
  self.IMAPClient.getBoxes('', function (err, boxes) {
    if (err) {
      return callback(err)
    }

    for (i in boxes) {
      boxes[i].noselect = boxes[i].attribs.indexOf('\\NOSELECT') !== -1
    }

    callback(null, boxes)
  })
}

ImapStore.prototype.getHeaders = function (box, start, callback) {
  var self = this

  self.openBox(box, true, function (err, box) {
    if (err) {
      return callback(err)
    }

    self._fetchWithOptions(
      start,
      'HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE)',
      callback
    )
  })
}

ImapStore.prototype.getFlags = function (box, range, callback) {
  var self = this

  self.openBox(box, true, function (err, box) {
    if (err) {
      console.log('MAILX: ' + err)
      return callback(err)
    }
    self._fetchRaw(range, 'HEADER.FIELDS (MESSAGE-ID)', callback)
  })
}

ImapStore.prototype.getMessages = function (box, start, callback) {
  var self = this
  self.openBox(box, function (err, box) {
    if (err) {
      return callback(err)
    }

    self._fetch(start, function (err, messages) {
      self.closeBox()
      callback(err, messages)
    })
  })
}

ImapStore.prototype.openBox = function (box, readonly, cb) {
  this.IMAPClient.openBox(box, readonly, cb)
}

ImapStore.prototype.closeBox = function () {
  var self = this
  self.IMAPClient.closeBox(true, function () {})
}

ImapStore.prototype.close = function () {
  var self = this
  self._openInbox(function (err, box) {
    if (err) {
      return defer.reject(err)
    }
    var startFrom = start || 1
    var fetchMessages = self.IMAPClient.fetch(startFrom + ':' + box.uidnext, {
      bodies: '',
      struct: true
    })
    var count = 0
    var notified = 0
    self._end = false

    fetchMessages.on('message', function (msg, seqno) {
      count++
      var rawMessage = new Buffer(0)
      var uid
      msg.on('body', function (stream) {
        var buffers = []
        stream.on('data', function (chunk) {
          buffers.push(chunk)
        })
        stream.once('end', function () {
          rawMessage = Buffer.concat(buffers)
        })
      })
      msg.once('attributes', function (attrs) {
        uid = attrs.uid
      })
      msg.once('end', function () {
        Message.createFromRaw(rawMessage, function (err, msg) {
          if (err) {
            return defer.reject(err)
          }
          msg.delete = function (cb) {
            if (self.status !== STATE.LOGGED_IN) {
              return cb(new Error('NOT LOGGED IN!'))
            }
            self.deleteMessage(uid, cb)
          }

          msg.uid = uid
          msg.seqNumber = seqno
          defer.notify(msg)
          // if no waiting getNextMessage in queue then push message in inboxMessagesQueue
          if (self.getNextMessageQueue.length === 0) {
            self.inboxMessagesQueue.push(msg)
          } else {
            var cb = self.getNextMessageQueue.shift()
            cb(null, msg)
          }
          notified++
          if (self._end && count === notified) {
            defer.resolve({ received: count })
          }
        })
      })
    })

    fetchMessages.once('error', function (err) {
      defer.reject(err)
      try {
        self.IMAPClient.closeBox(true)
        self.IMAPClient.end()
      } catch (e) {}
    })

    fetchMessages.once('end', function () {
      self._end = true
      if (self.inboxMessagesQueue.length === 0 && count === notified) {
        for (var i = 0; i < self.getNextMessageQueue.length; i++) {
          var cb = self.getNextMessageQueue.shift()
          cb(null, null)
        }
        defer.resolve({ received: count })
      }
    })
  })

  return defer.promise({
    close: function (cb) {
      cb = cb || function () {}
      self.IMAPClient.closeBox(true, function (err) {
        self.IMAPClient.end()
        if (err) {
          return cb(err)
        }
        cb()
      })
    },
    getNextMessage: function (cb) {
      // if no message in inboxMessagesQueue then push callback in getNextMessageQueue
      if (self.inboxMessagesQueue.length === 0) {
        // check if all messages has been received
        if (self._end) {
          return cb(null, null)
        }
        self.getNextMessageQueue.push(cb)
      } else {
        cb(null, self.inboxMessagesQueue.shift())
      }
    }
  })
}

ImapStore.prototype.getInboxMessages = function (start, callback) {
  var self = this
  this.getMessages('INBOX', start, callback)
  self._openInbox(function (err) {
    if (err) {
      return callback(err)
    }
    self._fetch(start, function (err, data) {
      if (err) {
        return callback(err, data)
      }
      self.IMAPClient.closeBox(true, function (err) {
        callback(err, data)
      })
    })
  })
}

ImapStore.prototype.getMessages = function (start, box, callback) {
  var self = this
  if (_.isFunction(box)) {
    callback = box
    box = void 0
  }
  if (box) {
    this.openBox(box, function (err) {
      if (err) {
        return callback(err)
      }
      self._fetch(start, callback)
    })
  } else {
    this._fetch(start, callback)
  }
}

ImapStore.prototype.getMessagesAsStream = function (
  from,
  to,
  batchSize,
  box,
  callback
) {
  var self = this
  var lastBatch = false

  if (_.isFunction(box)) {
    callback = box
    box = void 0
  }

  var deferred = asynk.deferred()
  var promise = deferred.promise()

  promise.done(function () {
    ++batchSize

    var lastMailId = self.box.uidnext - 1
    to = to === 'last' ? lastMailId : to
    from = from === 'last' ? lastMailId : from

    var messagesStream = streamize.obj.Transform(function (chunk, cb) {
      if (messagesStream._writableState.length < batchSize / 2) {
        messagesStream.emit('sendNextBatch')
      }
      Message.createFromRaw(chunk.raw, function (err, msg) {
        if (err) {
          return cb(err)
        }
        msg.delete = function (cb) {
          if (self.status !== STATE.LOGGED_IN) {
            return cb(new Error('NOT LOGGED IN!'))
          }
          self.deleteMessage(chunk.uid, cb)
        }

        msg.uid = chunk.uid
        msg.seqNumber = chunk.seqno
        cb(null, msg)
      })
    })

    callback(null, messagesStream)

    // No new mail
    if (from === lastMailId && to === lastMailId) {
      messagesStream.end()
      return
    }

    var fetchNextBatch = function (start, end, cb) {
      var fetchMessages = self.IMAPClient.fetch(start + ':' + end, {
        bodies: '',
        struct: true
      })
      var msgs = []

      fetchMessages.on('message', function (msg, seqno) {
        var rawMessage = new Buffer(0)
        var uid
        msg.on('body', function (stream) {
          var buffers = []
          stream.on('data', function (chunk) {
            buffers.push(chunk)
          })
          stream.once('end', function () {
            rawMessage = Buffer.concat(buffers)
          })
        })
        msg.once('attributes', function (attrs) {
          uid = attrs.uid
        })
        msg.once('end', function () {
          msgs.push({ raw: rawMessage, uid: uid, seqno: seqno })
        })
      })
      fetchMessages.once('error', function (err) {
        return cb(err)
      })
      fetchMessages.once('end', function () {
        return cb(null, msgs)
      })
    }

    var feedStream = function (start, direction, step) {
      var end
      var sort
      if (direction === 'desc') {
        end = start - step
        --start
        if (end < to) {
          end = to
          lastBatch = true
        }
        sort = function (a, b) {
          return b.uid - a.uid
        }
      } else {
        end = start + step
        ++start
        if (end > to) {
          end = to
          lastBatch = true
        }
        sort = function (a, b) {
          return a.uid - b.uid
        }
      }
      start = start < 1 ? 1 : start
      end = end < 1 ? 1 : end

      if (messagesStream._writableState.length < step / 2) {
        fetchNextBatch(start, end, function (err, msgs) {
          if (err) {
            messagesStream.emit('error', err)
            return
          }
          msgs.sort(function (a, b) {
            return sort(a, b)
          })
          msgs.forEach(function (msg) {
            messagesStream.write(msg)
          })
          if (lastBatch) {
            return messagesStream.end()
          }
          return feedStream(end, direction, step)
        })
      } else {
        messagesStream.once('sendNextBatch', function () {
          fetchNextBatch(start, end, function (err, msgs) {
            if (err) {
              messagesStream.emit('error', err)
              return
            }
            msgs.sort(function (a, b) {
              return sort(a, b)
            })
            msgs.forEach(function (msg) {
              messagesStream.write(msg)
            })

            if (lastBatch) {
              return messagesStream.end()
            }
            return feedStream(end, direction, step)
          })
        })
      }
    }

    var direction = from > to ? 'desc' : 'asc'
    from = direction === 'desc' ? from + 1 : from - 1
    feedStream(from, direction, batchSize)
  })

  if (box) {
    this.openBox(box, function (err) {
      if (err) {
        return callback(err)
      }
      deferred.resolve()
    })
  } else {
    deferred.resolve()
  }
}

ImapStore.prototype.deleteMessage = function (uid, expunge, box, cb) {
  var self = this

  if (_.isFunction(box)) {
    cb = box
    box = void 0
  }

  if (_.isFunction(expunge)) {
    cb = expunge
    expunge = void 0
  }

  if (_.isString(expunge)) {
    box = expunge
    expunge = void 0
  }

  var deferred = asynk.deferred()
  var promise = deferred.promise()

  promise.done(function () {
    self.IMAPClient.addFlags(uid, 'DELETED', function (err) {
      if (err) {
        return cb(err)
      }
      if (expunge) {
        return self.expunge(uid, cb)
      }
      cb()
    })
  })

  if (box) {
    this.openBox(box, function (err) {
      if (err) {
        return cb(err)
      }
      deferred.resolve()
    })
  } else {
    deferred.resolve()
  }
}

ImapStore.prototype.expunge = function (uid, cb) {
  this.IMAPClient.expunge(uid, cb)
}

ImapStore.prototype._openInbox = function (cb) {
  this.IMAPClient.openBox('INBOX', false, cb)
}

ImapStore.prototype.move = function (uids, boxTo, boxFrom, cb) {
  var self = this
  if (_.isFunction(boxFrom)) {
    cb = boxFrom
    boxFrom = void 0
  }

  var deferred = asynk.deferred()
  var promise = deferred.promise()

  promise.done(function () {
    self.IMAPClient.move(uids, boxTo, cb)
  })

  if (boxFrom) {
    this.openBox(boxFrom, function (err) {
      if (err) {
        return cb(err)
      }
      deferred.resolve()
    })
  } else {
    deferred.resolve()
  }
}

ImapStore.prototype.getLastID = function () {
  return this.box.uidnext - 1
}

ImapStore.prototype.getBoxes = function (cb) {
  var self = this
  if (self.boxes) {
    var boxesNames = []
    Object.keys(self.boxes).forEach(function (boxName) {
      boxesNames.push(boxName)
    })
    return cb(null, boxesNames)
  }
  this.IMAPClient.getBoxes(function (err, boxes) {
    if (err) {
      return cb(err)
    }
    self.boxes = boxes
    var boxesNames = []
    Object.keys(boxes).forEach(function (boxName) {
      boxesNames.push(boxName)
    })
    cb(err, boxesNames)
  })
}

ImapStore.prototype.getBox = function (boxName, cb) {
  var self = this
  if (!this.boxes) {
    this.getBoxes(function (err) {
      if (err) {
        return cb(err)
      }
      if (!self.boxes[boxName]) {
        return cb(new Error('Unknown box : ' + boxName))
      }
      return cb(null, self.boxes[boxName])
    })
  } else {
    if (!self.boxes[boxName]) {
      return cb(new Error('Unknown box : ' + boxName))
    }
    return cb(null, self.boxes[boxName])
  }
}

ImapStore.prototype.openBox = function (boxName, cb) {
  var self = this
  this.IMAPClient.openBox(boxName, false, function (err, box) {
    self.box = box
    return cb(err, box)
  })
}

ImapStore.prototype.closeBox = function (cb) {
  this.IMAPClient.closeBox(false, cb)
}

ImapStore.prototype._fetch = function (start, callback) {
  this._fetchWithOptions(start, '', callback)
}

ImapStore.prototype._fetchWithOptions = function (start, bodies, callback) {
  this._fetchRaw(start + ':*', bodies, callback)
}

ImapStore.prototype._fetchRaw = function (range, bodies, callback) {
  var self = this
  start = start || 1
  var msgs = []
  var fetchMessages = self.IMAPClient.fetch(range, {
    bodies: bodies,
    struct: true
  })

  fetchMessages.on('message', function (msg, seqno) {
    var rawMessage = new Buffer(0)
    var attributes
    msg.on('body', function (stream, info) {
      var buffers = []
      stream.on('data', function (chunk) {
        buffers.push(chunk)
      })
      stream.once('end', function () {
        rawMessage = Buffer.concat(buffers)
      })
    })
    msg.once('attributes', function (attrs) {
      attributes = attrs
    })
    msg.once('end', function () {
      msgs.push({ raw: rawMessage, attrs: attributes, seqno: seqno })
    })
  })
  fetchMessages.once('error', function (err) {
    console.log('MAILX: ' + err)
    console.log('Range: ' + range + '\tBodies: ' + bodies)
    callback(err, null)
  })
  fetchMessages.once('end', function () {
    var getMessages = asynk
      .each(msgs, function (message, cb) {
        Message.createFromRaw(message.raw, function (err, msg) {
          if (err) {
            return cb(err)
          }
          msg.delete = function (cb) {
            if (self.status !== STATE.LOGGED_IN) {
              return cb(new Error('NOT LOGGED IN!'))
            }
            self.deleteMessage(message.uid, cb)
          }

          msg = self._parseFlags(msg, message.attrs)
          msg.uid = message.attrs.uid
          msg.seqNumber = message.seqno

          cb(null, msg)
        })
      })
      .parallel()
    getMessages
      .done(function (messages) {
        callback(null, messages)
      })
      .fail(callback)
  })
}

ImapStore.prototype._parseFlags = function (msg, attrs) {
  var self = this
  var flags = {
    '\\Answered': 'answered',
    '\\Deleted': 'deleted',
    '\\Draft': 'draft',
    '\\Flagged': 'flagged',
    '\\New': 'new',
    '\\Recent': 'recent',
    '\\Seen': 'seen'
  }

  for (var flag in flags) {
    var index = attrs.flags.indexOf(flag)
    msg[flags[flag]] = index > -1
  }

  return msg
}

module.exports = ImapStore
