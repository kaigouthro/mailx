var POP3Client = require("./poplib");
var Message = require('./message');
var asynk = require('asynk');
var _ = require('lodash');
var util = require('util');
var inspect = require('util').inspect;
var streamize = require('streamize');

var STATE = {
  'CLOSED': 0,
  'CONNECTING': 1,
  'CONNECTED': 3,
  'LOGGED_IN': 4
};

var PopStore = function() {
  this.status = null;
};

PopStore.prototype.connect = function(callback) {
  var self = this;
  this.POP3Client = new POP3Client(this.port, this.host, {
    ignoretlserrs: true,
    enabletls: self.tls,
    debug: false
  });
  this.status = STATE.CONNECTING;
  this.POP3Client.connect(function(err, data) {
    if (err) {
      return callback(err);
    }
    this.status = STATE.CONNECTED;
    self._capa(function(err, capa) {
      if (err) {
        // if server has no CAPA command, try simple login
        return self._login(callback);
      }
      // check if server has STLS capability
      if (capa.STLS) {
        self.POP3Client.stls(function(err, rawdata) {
          if (err) {
            self.POP3Client.quit();
            return callback(err);
          }
          self._login(callback);
        });
      } else {
        self._login(callback);
      }
    });
  });
};

PopStore.prototype._capa = function(callback) {
  this.POP3Client.capa(function(err, capa) {
    if (err) {
      return callback(err);
    }
    var lines = capa.split("\r\n");
    var capabilities = {};
    lines.forEach(function(line) {
      let capability = line.match(/^[A-Za-z\-]+/);
      if (!capability) {
        return;
      }
      let params = capability && line.substr(capability[0].length + 1).trim();
      capability = capability[0].toUpperCase();
      if (capability === "IMPLEMENTATION") {
        return capabilities[capability] = params;
      }
      if (params === "") {
        return capabilities[capability] = true;
      }
      params = (params || "").split(" ");
      params.forEach(function(param, index) {
        params[index] = param.trim().toUpperCase();
      });
      capabilities[capability] = params;
    });
    callback(null, capabilities);
  });
};

PopStore.prototype._login = function(callback) {
  var self = this;
  self.POP3Client.login(self.login, self.password, function(err, rawdata) {
    if (err) {
      self.POP3Client.quit();
      self.status = STATE.CLOSED;
      return callback(err);
    }
    self.status = STATE.LOGGED_IN;
    callback(null, rawdata);
  });
};

PopStore.prototype.close = function(callback) {
  try {
    this.status = STATE.CLOSED;
    this.POP3Client.quit();
    if (callback) {
      callback();
    }
  } catch (e) {
    if (callback) {
      return callback(e);
    }
    throw e;
  }
};

PopStore.prototype.getInboxMessagesAsStream = function(from, to, batchSize, callback) {
  var self = this;
  var lastBatch = false;
  self.getLastID(function(err, lastMailId) {
    if (err) {
      return callback(err);
    }
    console.log('LAST MAIL ID : ', lastMailId);
    to = to === 'last' ? lastMailId : to;
    from = from === 'last' ? lastMailId : from;

    var messagesStream = streamize.obj.Transform(function(chunk, cb) {
      if (messagesStream._writableState.length < batchSize / 2) {
        messagesStream.emit('sendNextBatch');
      };
      Message.createFromRaw(chunk.raw, function(err, msg) {
        if (err) {
          return cb(err);
        }
        msg.delete = function(cb) {
          if (self.status !== STATE.LOGGED_IN) {
            return cb(new Error('NOT LOGGED IN!'));
          }
          self.deleteMessage(chunk.seqno, cb);
        };

        msg.uid = chunk.uid;
        msg.seqNumber = chunk.seqno;
        cb(null, msg);
      });
    });

    callback(null, messagesStream);

    if (from === lastMailId && to === lastMailId) {
      messagesStream.end();
      return;
    }

    var fetchNextBatch = function(start, end, cb) {
      console.log('FETCH RANGE : ', start + ':' + end);
      var list = [];
      for (var i = start; i >= end; i--) {
        list.push(i);
      }
      asynk.each(list, function(seqno, cback) {
        self.POP3Client.retr(seqno, function(err, rawMessage) {
          if (err) {
            return cback(err);
          }
          cback(null, { raw: rawMessage, uid: null, seqno: parseInt(seqno, 10) });
        });
      }).serie().fail(cb)
      .done(function(messages) {
        return cb(null, messages);
      });
    };

    var feedStream = function(start, direction, step) {
      var end;
      var sort;
      if (direction === 'desc') {
        end = start - step;
        --start;
        if (end < to) {
          end = to;
          lastBatch = true;
        }
        sort = function(a,b) {
          return b.uid - a.uid;
        };
      } else {
        end = start + step;
        ++start;
        if (end > to) {
          end = to;
          lastBatch = true;
        }
        sort = function(a,b) {
          return a.uid - b.uid;
        };
      }
      start = start < 1 ? 1 : start;
      end = end < 1 ? 1 : end;

      if (messagesStream._writableState.length < step / 2) {
        fetchNextBatch(start, end, function(err, msgs) {
          if (err) {
            messagesStream.emit('error', err);
            return;
          }
          msgs.sort(function(a,b) {
            return b.seqno - a.seqno;
          });
          msgs.forEach(function(msg) {
            messagesStream.write(msg);
          });
          if (lastBatch) {
            return messagesStream.end();
          }
          return feedStream(end, direction, step);
        });
      } else {
        messagesStream.once('sendNextBatch', function() {
          fetchNextBatch(start, end, function(err, msgs) {
            if (err) {
              messagesStream.emit('error', err);
              return;
            }
            msgs.sort(function(a,b) {
              return b.uid - a.uid;
            });
            msgs.forEach(function(msg) {
              messagesStream.write(msg);
            });

            if (lastBatch) {
              return messagesStream.end();
            }
            return feedStream(end, direction, step);
          });
        });
      }
    };

    var direction = from > to ? 'desc' : 'asc';
    from = direction === 'desc' ? from + 1 : from - 1;
    feedStream(from, direction, batchSize);
  });
};

PopStore.prototype.getLastID = function(cb) {
  this._list(0, function(err, fullList) {
    if (err) {
      return cb(err);
    }
    var lastMailId = parseInt(fullList[fullList.length - 1], 10);
    return cb(null, lastMailId);
  });
};

PopStore.prototype.getBoxes = function(cb) {
  var self = this;
  self.boxes = {};
  cb(null, ['INBOX']);
};

PopStore.prototype.getBox = function(boxName, cb) {
  var self = this;
  if (boxName !== 'INBOX') {
    return cb(new Error('POP3 only support an INBOX box'));
  }
  return cb(null, {});
};

PopStore.prototype.openBox = function(boxName, cb) {
  return cb(null, null);
};

PopStore.prototype.closeBox = function(cb) {
  this.close(cb);
};


PopStore.prototype.getInboxMessages = function(start, callback) {
  var self = this;

  self._list(start, function(err, list) {
    if (err) {
      return callback(err);
    }
    var inbox = asynk.each(list, function(seqno, cb) {
      self.POP3Client.retr(seqno, function(err, rawMessage) {
        if (err) {
          return cb(err);
        }
        cb(null, { raw: rawMessage, uid: null, seqno: parseInt(seqno, 10) });
      });
    }).serie();
    inbox.fail(callback);
    inbox.done(function(messages) {
      var parsedMessages = asynk.each(messages, function(message, cb) {
        Message.createFromRaw(message.raw, function(err, msg) {
          if (err) {
            return cb(err);
          }
          msg.delete = function(cb) {
            if (self.status !== STATE.LOGGED_IN) {
              return cb(new Error('NOT LOGGED IN!'));
            }
            self.deleteMessage(message.seqno, cb);
          };

          msg.uid = message.uid;
          msg.seqNumber = message.seqno;

          cb(null, msg);
        });
      }).parallel();
      parsedMessages.fail(callback);
      parsedMessages.done(function(messages) {
        callback(null, messages);
      });
    });
  });
};

PopStore.prototype.getInbox = function(start) {
  var defer = asynk.deferred();
  this.inboxMessagesQueue = [];
  this.getNextMessageQueue = [];
  this._end = false;
  var self = this;

  self._list(start, function(err, list) {
    if (err) {
      return defer.reject(err);
    }
    if (!list.length) {
      self._end = true;
      for (var i = 0; i < self.getNextMessageQueue.length; i++) {
        var cb = self.getNextMessageQueue.shift();
        cb(null, null);
      }
      return defer.resolve({ received: 0 });
    }
    var inbox = asynk.each(list, function(seqno, cb) {
      self.POP3Client.retr(seqno, function(err, rawMessage) {
        if (err) {
          return cb(err);
        }
        Message.createFromRaw(rawMessage, function(err, msg) {
          if (err) {
            return cb(err);
          }
          msg.delete = function(cb) {
            if (self.status !== STATE.LOGGED_IN) {
              return cb(new Error('NOT LOGGED IN!'));
            }
            self.deleteMessage(seqno, cb);
          };
          msg.uid = null;
          msg.seqNumber = seqno;
          defer.notify(msg);
          // if no waiting getNextMessage in queue then push message in inboxMessagesQueue
          if (self.getNextMessageQueue.length === 0) {
            self.inboxMessagesQueue.push(msg);
          } else {
            var NextMessageCb = self.getNextMessageQueue.shift();
            NextMessageCb(null, msg);
          }
          cb();
        });
      });
    }).serie().fail(function(err) {
      defer.reject(err);
    }).done(function() {
      self._end = true;
      defer.resolve({ received: list.length });
    });
  });

  return defer.promise({
    close: function(cb) {
      cb = cb || function() { };
      self.close();
      cb();
    },
    getNextMessage: function(cb) {
      // if no message in inboxMessagesQueue then push callback in getNextMessageQueue
      if (self.inboxMessagesQueue.length === 0) {
        // check if all messages has been received
        if (self._end) {
          return cb(null, null);
        }
        self.getNextMessageQueue.push(cb);
      } else {
        cb(null, self.inboxMessagesQueue.shift());
      }
    }
  });
};

PopStore.prototype.deleteMessage = function(seqno, callback) {
  this.POP3Client.dele(seqno, callback);
};

PopStore.prototype._list = function(start, callback) {
  callback = callback || function() { };
  this.POP3Client.list(null, function(err, list) {
    if (err) {
      return callback(err);
    }
    var filteredIndexes = _.filter(_.keys(list), function(seqNo) {
      return parseInt(seqNo, 10) >= start;
    });
    callback(null, filteredIndexes);
  });
};

module.exports = PopStore;
