var mailx = require('../../main.js');
var popServer = require("pop-server");
var assert = require('assert');
var _ = require('lodash');
var fs = require('fs');
var path = require('path');
var mailcomposer = require("nodemailer/lib/mail-composer");
var streamize = require('streamize');
var fixtures = require('../fixtures/mail');
var asynk = require('asynk');


var server;
var store;
var connection;
var uids = ['msg_1', 'msg_2', 'msg_3'];

var options = {
  auth: function(user, checkPassword) {
    var password = false;
    if (user === 'login') {
      password = 'password';
    }
    return checkPassword(password);
  },
  store: {
    register: function(cb) {
      connection = this.connection;
      if (this.user === "login") {
        var self = this;
        uids.forEach(function(uid) {
          self.addMessage(uid, 40);
        });
      }
      cb();
    },
    read: function(uid, cb) {
      var message = mailx.message();
      message.setFrom('me', 'me@example.net');
      message.addTo('you', 'you@example.net');
      message.setSubject('hello');
      message.setText('hi ! how are u?');
      message.setHtml('hi ! how are u? <b>hugs</b>');
      var mail = new mailcomposer(message);
      mail.compile().build(cb);
    },
    removeDeleted: function(deleted, cb) {
      deleted.forEach(function(uid) {
        var index = uids.indexOf(uid);
        if (index > -1) {
          uids.splice(index, 1);
        }
      });
      cb();
    }
  }
};


describe('POP3', function() {
  var store;

  beforeEach(function(done) {
    this.timeout(10000);
    var transport = mailx.transport('172.18.0.10', 2525);
    store = mailx.store('pop3', '172.18.0.10', 110, 'root', 'pass');
    var beforeStore = mailx.store('pop3', '172.18.0.10', 110, 'root', 'pass');
    fixtures.fillMails(['INBOX'], transport, beforeStore, function(err) {
      if (err) {
        throw err;
      }
      store.connect(function(err) {
        if (err) {
          throw err;
        }
        done();
      });
    });
  });

  afterEach(function(done) {
    this.timeout(10000);
    var transport = mailx.transport('172.18.0.10', 2525);
    var afterStore = mailx.store('pop3', '172.18.0.10', 110, 'root', 'pass');
    fixtures.emptyMails(['INBOX'], transport, afterStore, function(err) {
      if (err) {
        throw err;
      }
      store.close(function(err) {
        if (err) {
          throw err;
        }
        done();
      });
    });
  });

  it('getInboxMessages() should receive all messages from inbox', function(done) {
    store.getInboxMessages(1, function(err, messages) {
      if (err) {
        return done(err);
      }
      assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
      assert.equal(messages[0].subject, 'subject1');
      assert.equal(messages[1].subject, 'subject2');
      assert.equal(messages[2].subject, 'subject3');
      done();
    });
  });

  it('getMessages() should receive all messages from each boxes', function(done) {
    store.getBoxes(function(err, boxes) {
      if (err) {
        return done(err);
      }
      var totalMessages = 0;
      asynk.each(boxes, function(boxName, cb) {
        store.openBox(boxName, function(err) {
          if (err) {
            return cb(err);
          }
          store.getMessages(0, function(err, messages) {
            if (err) {
              return done(err);
            }
            totalMessages += messages.length;
            switch (boxName) {
              case 'INBOX':
                assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
                assert.equal(messages[0].subject, 'subject1');
                assert.equal(messages[1].subject, 'subject2');
                assert.equal(messages[2].subject, 'subject3');
                return cb();
              default:
                return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
            }
          });
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 3, 'should have received all messages');
        done();
      });
    });
  });

  it('getMessages() should receive all messages from each boxes without manual opening of each box', function(done) {
    store.getBoxes(function(err, boxes) {
      if (err) {
        return done(err);
      }
      var totalMessages = 0;
      asynk.each(boxes, function(boxName, cb) {
        store.getMessages(0, boxName, function(err, messages) {
          if (err) {
            return done(err);
          }
          totalMessages += messages.length;
          switch (boxName) {
            case 'INBOX':
              assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
              assert.equal(messages[0].subject, 'subject1');
              assert.equal(messages[1].subject, 'subject2');
              assert.equal(messages[2].subject, 'subject3');
              return cb();
            default:
              return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
          }
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 3, 'should have received all messages');
        done();
      });
    });
  });

  it('deleteMessage() with expunge parameter and without manual box opening should delete the messages', function(done) {
    store.deleteMessage('1:*', true, 'INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessages(0, 'INBOX', function(err, messages) {
        if (err) {
          return done(err);
        }
        assert.equal(messages.length, 0, 'messages should have been deleted');
        return done();
      });
    });
  });

  it('deleteMessage() with manual expunge should delete the messages', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.deleteMessage('1:*', function(err) {
        if (err) {
          return done(err);
        }
        store.expunge(function(err) {
          if (err) {
            return done(err);
          }
          store.getMessages(0, function(err, messages) {
            if (err) {
              return done(err);
            }
            assert.equal(messages.length, 0, 'messages should have been deleted');
            return done();
          });
        });
      });
    });
  });

  it('Manually calling expunge() without having any Deleted flags should do nothing', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.expunge(function(err) {
        if (err) {
          return done(err);
        }
        store.getMessages(0, function(err, messages) {
          if (err) {
            return done(err);
          }
          assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
          assert.equal(messages[0].subject, 'subject1');
          assert.equal(messages[1].subject, 'subject2');
          assert.equal(messages[2].subject, 'subject3');
          return done();
        });
      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessagesAsStream(0, 'last', 100, function(err, stream) {
        if (err) {
          return done(err);
        }

        var totalMessages = 0;
        var messagesSubject = ['subject1', 'subject2', 'subject3'];
        var transform = streamize.obj.Transform(function(chunk, cb) {
          assert.equal(chunk.subject, messagesSubject[totalMessages]);
          ++totalMessages;
          cb(null, chunk);
        });

        transform.on('finish', function() {
          assert.equal(totalMessages, 3, 'should receive 3 messages from inbox');
          done();
        });

        stream.pipe(transform);

      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream without manually opening box', function(done) {
    store.getMessagesAsStream(0, 'last', 100, 'INBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject1', 'subject2', 'subject3'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 3, 'should receive 3 messages from inbox');
        done();
      });

      stream.pipe(transform);
    });
  });

  it('getMessagesAsStream() should receive all messages from last to first', function(done) {
    store.getMessagesAsStream('last', 0, 100, 'INBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject3', 'subject2', 'subject1'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 3, 'should receive 3 messages from inbox');
        done();
      });

      stream.pipe(transform);
    });
  });

});


describe('POP3S', function() {
  var store;

  beforeEach(function(done) {
    this.timeout(10000);
    var transport = mailx.transport('172.18.0.10', 2525);
    store = mailx.store('pop3s', '172.18.0.10', 995, 'root', 'pass');
    var beforeStore = mailx.store('pop3s', '172.18.0.10', 995, 'root', 'pass');
    fixtures.fillMails(['INBOX'], transport, beforeStore, function(err) {
      if (err) {
        throw err;
      }
      store.connect(function(err) {
        if (err) {
          throw err;
        }
        done();
      });
    });
  });

  afterEach(function(done) {
    this.timeout(10000);
    var transport = mailx.transport('172.18.0.10', 2525);
    var afterStore = mailx.store('pop3s', '172.18.0.10', 995, 'root', 'pass');
    fixtures.emptyMails(['INBOX'], transport, afterStore, function(err) {
      if (err) {
        throw err;
      }
      store.close(function(err) {
        if (err) {
          throw err;
        }
        done();
      });
    });
  });

  it('getInboxMessages() should receive all messages from inbox', function(done) {
    store.getInboxMessages(1, function(err, messages) {
      if (err) {
        return done(err);
      }
      assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
      assert.equal(messages[0].subject, 'subject1');
      assert.equal(messages[1].subject, 'subject2');
      assert.equal(messages[2].subject, 'subject3');
      done();
    });
  });

  it('getMessages() should receive all messages from each boxes', function(done) {
    store.getBoxes(function(err, boxes) {
      if (err) {
        return done(err);
      }
      var totalMessages = 0;
      asynk.each(boxes, function(boxName, cb) {
        store.openBox(boxName, function(err) {
          if (err) {
            return cb(err);
          }
          store.getMessages(0, function(err, messages) {
            if (err) {
              return done(err);
            }
            totalMessages += messages.length;
            switch (boxName) {
              case 'INBOX':
                assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
                assert.equal(messages[0].subject, 'subject1');
                assert.equal(messages[1].subject, 'subject2');
                assert.equal(messages[2].subject, 'subject3');
                return cb();
              default:
                return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
            }
          });
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 3, 'should have received all messages');
        done();
      });
    });
  });

  it('getMessages() should receive all messages from each boxes without manual opening of each box', function(done) {
    store.getBoxes(function(err, boxes) {
      if (err) {
        return done(err);
      }
      var totalMessages = 0;
      asynk.each(boxes, function(boxName, cb) {
        store.getMessages(0, boxName, function(err, messages) {
          if (err) {
            return done(err);
          }
          totalMessages += messages.length;
          switch (boxName) {
            case 'INBOX':
              assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
              assert.equal(messages[0].subject, 'subject1');
              assert.equal(messages[1].subject, 'subject2');
              assert.equal(messages[2].subject, 'subject3');
              return cb();
            default:
              return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
          }
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 3, 'should have received all messages');
        done();
      });
    });
  });

  it('deleteMessage() with expunge parameter and without manual box opening should delete the messages', function(done) {
    store.deleteMessage('1:*', true, 'INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessages(0, 'INBOX', function(err, messages) {
        if (err) {
          return done(err);
        }
        assert.equal(messages.length, 0, 'messages should have been deleted');
        return done();
      });
    });
  });

  it('deleteMessage() with manual expunge should delete the messages', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.deleteMessage('1:*', function(err) {
        if (err) {
          return done(err);
        }
        store.expunge(function(err) {
          if (err) {
            return done(err);
          }
          store.getMessages(0, function(err, messages) {
            if (err) {
              return done(err);
            }
            assert.equal(messages.length, 0, 'messages should have been deleted');
            return done();
          });
        });
      });
    });
  });

  it('Manually calling expunge() without having any Deleted flags should do nothing', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.expunge(function(err) {
        if (err) {
          return done(err);
        }
        store.getMessages(0, function(err, messages) {
          if (err) {
            return done(err);
          }
          assert.equal(messages.length, 3, 'should receive 3 messages from inbox');
          assert.equal(messages[0].subject, 'subject1');
          assert.equal(messages[1].subject, 'subject2');
          assert.equal(messages[2].subject, 'subject3');
          return done();
        });
      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessagesAsStream(0, 'last', 100, function(err, stream) {
        if (err) {
          return done(err);
        }

        var totalMessages = 0;
        var messagesSubject = ['subject1', 'subject2', 'subject3'];
        var transform = streamize.obj.Transform(function(chunk, cb) {
          assert.equal(chunk.subject, messagesSubject[totalMessages]);
          ++totalMessages;
          cb(null, chunk);
        });

        transform.on('finish', function() {
          assert.equal(totalMessages, 3, 'should receive 3 messages from inbox');
          done();
        });

        stream.pipe(transform);

      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream without manually opening box', function(done) {
    store.getMessagesAsStream(0, 'last', 100, 'INBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject1', 'subject2', 'subject3'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 3, 'should receive 3 messages from inbox');
        done();
      });

      stream.pipe(transform);
    });
  });

  it('getMessagesAsStream() should receive all messages from last to first', function(done) {
    store.getMessagesAsStream('last', 0, 100, 'INBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject3', 'subject2', 'subject1'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 3, 'should receive 3 messages from inbox');
        done();
      });

      stream.pipe(transform);
    });
  });

});
