var Imap = require('imap');
var Message = require('./message');
var asynk = require('asynk');

var STATE = {
  'CLOSED': 0,
  'CONNECTING': 1,
  'CONNECTED': 3,
  'LOGGED_IN': 4
};

var ImapStore = function() {
    this.status = null;
    this.STATE = STATE;
};

ImapStore.prototype.connect = function(callback) {
  var self = this;
  this.IMAPClient = new Imap({
    user: self.login,
    password: self.password,
    host: self.host,
    port: self.port,
    tls: self.tls,
    autotls: 'always',
    tlsOptions: { rejectUnauthorized: false }
  });
  this.IMAPClient.once('error', function(err) {
    this.end();
    var cb = callback;
    callback = function() { };
    cb(err, null);
  });
  this.IMAPClient.once('ready', function() {
    self.status = STATE.LOGGED_IN;
    var cb = callback;
    callback = function() { };
    cb(null, null);
  });
  this.IMAPClient.once('end', function() {
    self.status = STATE.CLOSED;
  });
  this.IMAPClient.connect();
  this.status = STATE.CONNECTING;
};


ImapStore.prototype.getMailboxes = function(callback) {
  var self = this;
  self.IMAPClient.getBoxes('', function(err, boxes) {
	if (err) {
	    return callback(err);
	}

	for (i in boxes) {
		boxes[i].noselect = boxes[i].attribs.indexOf('\\NOSELECT') !== -1 ? true : false;
	}

	callback(null, boxes);
    });
};

ImapStore.prototype.getHeaders = function(box, start, callback) {
  var self = this;

	self.openBox(box, true, function(err, box) {
		if (err)
	    return callback(err);

		self._fetchWithOptions(start, 'HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE)', callback);
	});

};

ImapStore.prototype.getFlags = function(box, range, callback) {
	var self = this;

	self.openBox(box, true, function(err, box) {
		if (err) {
			console.log('MAILX: ' + err);
			return callback(err);
		}
		self._fetchRaw(range, 'HEADER.FIELDS (MESSAGE-ID)', callback);
	});
};

ImapStore.prototype.getMessages = function(box, start, callback) {
  var self = this;
  self.openBox(box, function(err, box) {
		if (err) {
	    return callback(err);
		}

		self._fetch(start, function(err, messages) {
			self.closeBox();
			callback(err, messages)
		});

	});
};

ImapStore.prototype.openBox = function(box, readonly, cb) {
    this.IMAPClient.openBox(box, readonly, cb);
};

ImapStore.prototype.closeBox = function() {
	var self = this;
	self.IMAPClient.closeBox(true, function() {});
};

ImapStore.prototype.close = function() {
  var self = this;
  self._openInbox(function(err, box) {
    if (err) {
      return defer.reject(err);
    }
    var startFrom = start || 1;
    var fetchMessages = self.IMAPClient.fetch(startFrom + ':' + box.uidnext, { bodies: '', struct: true });
    var count = 0;
    var notified = 0;
    self._end = false;

    fetchMessages.on('message', function(msg, seqno) {
      count++;
      var rawMessage = new Buffer(0);
      var uid;
      msg.on('body', function(stream, info) {
        var buffers = [];
        stream.on('data', function(chunk) {
          buffers.push(chunk);
        });
        stream.once('end', function() {
          rawMessage = Buffer.concat(buffers);
        });
      });
      msg.once('attributes', function(attrs) {
        uid = attrs.uid;
      });
      msg.once('end', function() {
        Message.createFromRaw(rawMessage, function(err, msg) {
          if (err) {
            return defer.reject(err);
          }
          msg.delete = function(cb) {
            if (self.status !== STATE.LOGGED_IN) {
              return cb(new Error('NOT LOGGED IN!'));
            }
            self.deleteMessage(uid, cb);
          };

          msg.uid = uid;
          msg.seqNumber = seqno;
          defer.notify(msg);
          // if no waiting getNextMessage in queue then push message in inboxMessagesQueue
          if (self.getNextMessageQueue.length === 0) {
            self.inboxMessagesQueue.push(msg);
          } else {
            var cb = self.getNextMessageQueue.shift();
            cb(null, msg);
          }
          notified++;
          if (self._end && count === notified) {
            defer.resolve({ received: count });
          }
        });
      });
    });

    fetchMessages.once('error', function(err) {
      defer.reject(err);
      try {
        self.IMAPClient.closeBox(true);
        self.IMAPClient.end();
      } catch (e) {
        return;
      }
    });

    fetchMessages.once('end', function() {
      self._end = true;
      if ((self.inboxMessagesQueue.length === 0) && (count === notified)) {
        for (var i = 0; i < self.getNextMessageQueue.length; i++) {
          var cb = self.getNextMessageQueue.shift();
          cb(null, null);
        }
        defer.resolve({ received: count });
      }
    });
  });

ImapStore.prototype.getInboxMessages = function(start, callback) {
  this.getMessages('INBOX', start, callback);
};

ImapStore.prototype.deleteMessage = function(uid, cb) {
  this.IMAPClient.addFlags(uid, 'DELETED', cb);
};

ImapStore.prototype._openInbox = function(cb) {
  this.IMAPClient.openBox('INBOX', false, cb);
};

ImapStore.prototype._fetch = function(start, callback) {
  this._fetchWithOptions(start, '', callback);
};

ImapStore.prototype._fetchWithOptions = function(start, bodies, callback) {
	this._fetchRaw(start + ':*', bodies, callback);
},

ImapStore.prototype._fetchRaw = function(range, bodies, callback) {
  var self = this;
  var start = start || 1;
  var msgs = [];
  var fetchMessages = self.IMAPClient.fetch(range, {bodies: bodies, struct: true});

  fetchMessages.on('message', function(msg, seqno) {
    var rawMessage = new Buffer(0);
		var attributes;
    msg.on('body', function(stream, info) {
      var buffers = [];
      stream.on('data', function(chunk) {
        buffers.push(chunk);
      });
      stream.once('end', function() {
        rawMessage = Buffer.concat(buffers);
      });
    });
    msg.once('attributes', function(attrs) {
			attributes = attrs;
		});
    msg.once('end', function() {
			msgs.push({raw: rawMessage, attrs: attributes, seqno: seqno});
    });
  });
  fetchMessages.once('error', function(err) {
		console.log('MAILX: ' + err);
		console.log('Range: ' + range + '\tBodies: ' + bodies);
		callback(err, null);
  });
  fetchMessages.once('end', function() {
    var getMessages = asynk.each(msgs, function(message, cb) {
      Message.createFromRaw(message.raw, function(err, msg) {
        if (err) {
          return cb(err);
        }
        msg.delete = function(cb) {
          if (self.status !== STATE.LOGGED_IN) {
            return cb(new Error('NOT LOGGED IN!'));
          }
          self.deleteMessage(message.uid, cb);
        };

				msg = self._parseFlags(msg, message.attrs);
				msg.uid = message.attrs.uid;
				msg.seqNumber = message.seqno;

        cb(null, msg);
      });
    }).parallel();
    getMessages.done(function(messages) {
      callback(null, messages);
    }).fail(callback);
  });
};

ImapStore.prototype._parseFlags = function(msg, attrs) {
	var self = this;
	var flags = {
		'\\Answered': 'answered',
		'\\Deleted': 'deleted',
		'\\Draft': 'draft',
		'\\Flagged': 'flagged',
		'\\New': 'new',
		'\\Recent': 'recent',
		'\\Seen': 'seen'
	};

	for (var flag in flags) {
		var index = attrs.flags.indexOf(flag);
		msg[flags[flag]] = index > -1 ? true : false;
	}

	return msg;
};

module.exports = ImapStore;
