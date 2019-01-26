var mailx = require('../../main.js');
var fixtures = require('../fixtures/mail');
var assert = require('assert');
var _ = require('lodash');
var asynk = require('asynk');
var streamize = require('streamize');

var options = {
  plugins: ["ID", "SASL-IR", "AUTH-PLAIN", "NAMESPACE", "IDLE", "ENABLE", "CONDSTORE", "XTOYBIRD", "LITERALPLUS", "UNSELECT", "SPECIAL-USE", "CREATE-SPECIAL-USE"],
  id: {
    name: "mailxTestImap",
    version: "0.1"
  },
  users: {
    "login": {
      password: "password"
    }
  },
  storage: {
    "INBOX": {
      messages: [
        {
          raw: "Subject: subject1\r\n\r\n",
          internaldate: "22-Sep-2016 17:20:28 -0300"
        },
        {
          raw: "Subject: subject2\r\n\r\n",
          internaldate: "22-Sep-2016 17:22:22 -0300"
        },
        {
          raw: "Subject: subject3\r\n\r\n",
          internaldate: "22-Sep-2016 18:50:56 -0300"
        }
      ]
    },
    "OUTBOX": {
      messages: [
        {
          raw: "Subject: subject4\r\n\r\n",
          internaldate: "22-Sep-2016 20:20:28 -0300"
        },
        {
          raw: "Subject: subject5\r\n\r\n",
          internaldate: "22-Sep-2016 20:22:22 -0300"
        },
        {
          raw: "Subject: subject6\r\n\r\n",
          internaldate: "22-Sep-2016 20:40:56 -0300"
        },
        {
          raw: "Subject: subject7\r\n\r\n",
          internaldate: "22-Sep-2016 20:50:56 -0300"
        }
      ]
    },
    "BEATBOX": {
      messages: [
        {
          raw: "Subject: subject8\r\n\r\n",
          internaldate: "23-Sep-2016 20:20:28 -0300"
        },
        {
          raw: "Subject: subject9\r\n\r\n",
          internaldate: "23-Sep-2016 20:22:22 -0300"
        }
      ]
    }
  }
};


describe('IMAP', function() {
  var store;

  beforeEach(function(done) {
    this.timeout(10000);
    var transport = mailx.transport('172.18.0.10', 2525);
    store = mailx.store('imap', '172.18.0.10', 143, 'root', 'pass');
    var beforeStore = mailx.store('imap', '172.18.0.10', 143, 'root', 'pass');
    fixtures.fillMails(['OUTBOX', 'BEATBOX', 'INBOX'], transport, beforeStore, function(err) {
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
    var afterStore = mailx.store('imap', '172.18.0.10', 143, 'root', 'pass');
    fixtures.emptyMails(['OUTBOX', 'BEATBOX', 'INBOX'], transport, afterStore, function(err) {
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
              case 'OUTBOX':
                assert.equal(messages.length, 4, 'should receive 4 messages from outbox');
                assert.equal(messages[0].subject, 'subject4');
                assert.equal(messages[1].subject, 'subject5');
                assert.equal(messages[2].subject, 'subject6');
                assert.equal(messages[3].subject, 'subject7');
                return cb();
              case 'BEATBOX':
                assert.equal(messages.length, 2, 'should receive 2 messages from beatbox');
                assert.equal(messages[0].subject, 'subject8');
                assert.equal(messages[1].subject, 'subject9');
                return cb();
              default:
                return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
            }
          });
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 9, 'should have received all messages');
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
            case 'OUTBOX':
              assert.equal(messages.length, 4, 'should receive 4 messages from outbox');
              assert.equal(messages[0].subject, 'subject4');
              assert.equal(messages[1].subject, 'subject5');
              assert.equal(messages[2].subject, 'subject6');
              assert.equal(messages[3].subject, 'subject7');
              return cb();
            case 'BEATBOX':
              assert.equal(messages.length, 2, 'should receive 2 messages from beatbox');
              assert.equal(messages[0].subject, 'subject8');
              assert.equal(messages[1].subject, 'subject9');
              return cb();
            default:
              return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
          }
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 9, 'should have received all messages');
        done();
      });
    });
  });

  it('deleteMessage() without expunge should flag the mails but not delete them', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.deleteMessage('1:*', function(err) {
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
          assert.notEqual(messages[0].flags.indexOf('\\Deleted'), -1);
          assert.notEqual(messages[1].flags.indexOf('\\Deleted'), -1);
          assert.notEqual(messages[2].flags.indexOf('\\Deleted'), -1);
          return done();
        });
      });
    });
  });

  it('deleteMessage() with expunge parameter should delete the messages', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.deleteMessage('1:*', true, function(err) {
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

  it('Move() should move mails between boxes', function(done) {
    store.openBox('BEATBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.move('1:*', 'OUTBOX', function(err) {
        if (err) {
          return done(err);
        }
        store.openBox('OUTBOX', function(err) {
          if (err) {
            return done(err);
          }
          store.getMessages(0, function(err, messages) {
            if (err) {
              return done(err);
            }
            assert.equal(messages.length, 6, 'should receive 6 messages from outbox');
            assert.equal(messages[0].subject, 'subject4');
            assert.equal(messages[1].subject, 'subject5');
            assert.equal(messages[2].subject, 'subject6');
            assert.equal(messages[3].subject, 'subject7');
            assert.equal(messages[4].subject, 'subject8');
            assert.equal(messages[5].subject, 'subject9');
            return done();
          });
        });
      });
    });
  });

  it('Move() should move mails between boxes without the need to open each box manually', function(done) {
    store.move('1:*', 'OUTBOX', 'BEATBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessages(0, 'OUTBOX', function(err, messages) {
        if (err) {
          return done(err);
        }
        assert.equal(messages.length, 6, 'should receive 6 messages from outbox');
        assert.equal(messages[0].subject, 'subject4');
        assert.equal(messages[1].subject, 'subject5');
        assert.equal(messages[2].subject, 'subject6');
        assert.equal(messages[3].subject, 'subject7');
        assert.equal(messages[4].subject, 'subject8');
        assert.equal(messages[5].subject, 'subject9');
        return done();
      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream', function(done) {
    store.openBox('OUTBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessagesAsStream(0, 'last', 100, function(err, stream) {
        if (err) {
          return done(err);
        }

        var totalMessages = 0;
        var messagesSubject = ['subject4', 'subject5', 'subject6', 'subject7'];
        var transform = streamize.obj.Transform(function(chunk, cb) {
          assert.equal(chunk.subject, messagesSubject[totalMessages]);
          ++totalMessages;
          cb(null, chunk);
        });

        transform.on('finish', function() {
          assert.equal(totalMessages, 4, 'should receive 4 messages from outbox');
          done();
        });

        stream.pipe(transform);

      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream without manually opening box', function(done) {
    store.getMessagesAsStream(0, 'last', 100, 'OUTBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject4', 'subject5', 'subject6', 'subject7'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 4, 'should receive 4 messages from outbox');
        done();
      });

      stream.pipe(transform);
    });
  });

  it('getMessagesAsStream() should receive all messages from last to first', function(done) {
    store.getMessagesAsStream('last', 0, 100, 'OUTBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject7', 'subject6', 'subject5', 'subject4'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 4, 'should receive 4 messages from outbox');
        done();
      });

      stream.pipe(transform);
    });
  });

});


describe('IMAPS', function() {
  var store;

  beforeEach(function(done) {
    this.timeout(10000);
    var transport = mailx.transport('172.18.0.10', 2525);
    store = mailx.store('imaps', '172.18.0.10', 993, 'root', 'pass');
    var beforeStore = mailx.store('imaps', '172.18.0.10', 993, 'root', 'pass');
    fixtures.fillMails(['OUTBOX', 'BEATBOX', 'INBOX'], transport, beforeStore, function(err) {
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
    var afterStore = mailx.store('imaps', '172.18.0.10', 993, 'root', 'pass');
    fixtures.emptyMails(['OUTBOX', 'BEATBOX', 'INBOX'], transport, afterStore, function(err) {
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
              case 'OUTBOX':
                assert.equal(messages.length, 4, 'should receive 4 messages from outbox');
                assert.equal(messages[0].subject, 'subject4');
                assert.equal(messages[1].subject, 'subject5');
                assert.equal(messages[2].subject, 'subject6');
                assert.equal(messages[3].subject, 'subject7');
                return cb();
              case 'BEATBOX':
                assert.equal(messages.length, 2, 'should receive 2 messages from beatbox');
                assert.equal(messages[0].subject, 'subject8');
                assert.equal(messages[1].subject, 'subject9');
                return cb();
              default:
                return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
            }
          });
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 9, 'should have received all messages');
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
            case 'OUTBOX':
              assert.equal(messages.length, 4, 'should receive 4 messages from outbox');
              assert.equal(messages[0].subject, 'subject4');
              assert.equal(messages[1].subject, 'subject5');
              assert.equal(messages[2].subject, 'subject6');
              assert.equal(messages[3].subject, 'subject7');
              return cb();
            case 'BEATBOX':
              assert.equal(messages.length, 2, 'should receive 2 messages from beatbox');
              assert.equal(messages[0].subject, 'subject8');
              assert.equal(messages[1].subject, 'subject9');
              return cb();
            default:
              return done(new Error('OPENED AN UNKNOWN BOX : ' + boxName));
          }
        });
      }).serie().done(function() {
        assert.equal(totalMessages, 9, 'should have received all messages');
        done();
      });
    });
  });

  it('deleteMessage() without expunge should flag the mails but not delete them', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.deleteMessage('1:*', function(err) {
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
          assert.notEqual(messages[0].flags.indexOf('\\Deleted'), -1);
          assert.notEqual(messages[1].flags.indexOf('\\Deleted'), -1);
          assert.notEqual(messages[2].flags.indexOf('\\Deleted'), -1);
          return done();
        });
      });
    });
  });

  it('deleteMessage() with expunge parameter should delete the messages', function(done) {
    store.openBox('INBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.deleteMessage('1:*', true, function(err) {
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

  it('Move() should move mails between boxes', function(done) {
    store.openBox('BEATBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.move('1:*', 'OUTBOX', function(err) {
        if (err) {
          return done(err);
        }
        store.openBox('OUTBOX', function(err) {
          if (err) {
            return done(err);
          }
          store.getMessages(0, function(err, messages) {
            if (err) {
              return done(err);
            }
            assert.equal(messages.length, 6, 'should receive 6 messages from outbox');
            assert.equal(messages[0].subject, 'subject4');
            assert.equal(messages[1].subject, 'subject5');
            assert.equal(messages[2].subject, 'subject6');
            assert.equal(messages[3].subject, 'subject7');
            assert.equal(messages[4].subject, 'subject8');
            assert.equal(messages[5].subject, 'subject9');
            return done();
          });
        });
      });
    });
  });

  it('Move() should move mails between boxes without the need to open each box manually', function(done) {
    store.move('1:*', 'OUTBOX', 'BEATBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessages(0, 'OUTBOX', function(err, messages) {
        if (err) {
          return done(err);
        }
        assert.equal(messages.length, 6, 'should receive 6 messages from outbox');
        assert.equal(messages[0].subject, 'subject4');
        assert.equal(messages[1].subject, 'subject5');
        assert.equal(messages[2].subject, 'subject6');
        assert.equal(messages[3].subject, 'subject7');
        assert.equal(messages[4].subject, 'subject8');
        assert.equal(messages[5].subject, 'subject9');
        return done();
      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream', function(done) {
    store.openBox('OUTBOX', function(err) {
      if (err) {
        return done(err);
      }
      store.getMessagesAsStream(0, 'last', 100, function(err, stream) {
        if (err) {
          return done(err);
        }

        var totalMessages = 0;
        var messagesSubject = ['subject4', 'subject5', 'subject6', 'subject7'];
        var transform = streamize.obj.Transform(function(chunk, cb) {
          assert.equal(chunk.subject, messagesSubject[totalMessages]);
          ++totalMessages;
          cb(null, chunk);
        });

        transform.on('finish', function() {
          assert.equal(totalMessages, 4, 'should receive 4 messages from outbox');
          done();
        });

        stream.pipe(transform);

      });
    });
  });

  it('getMessagesAsStream() should receive all messages from stream without manually opening box', function(done) {
    store.getMessagesAsStream(0, 'last', 100, 'OUTBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject4', 'subject5', 'subject6', 'subject7'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 4, 'should receive 4 messages from outbox');
        done();
      });

      stream.pipe(transform);
    });
  });

  it('getMessagesAsStream() should receive all messages from last to first', function(done) {
    store.getMessagesAsStream('last', 0, 100, 'OUTBOX', function(err, stream) {
      if (err) {
        return done(err);
      }

      var totalMessages = 0;
      var messagesSubject = ['subject7', 'subject6', 'subject5', 'subject4'];
      var transform = streamize.obj.Transform(function(chunk, cb) {
        assert.equal(chunk.subject, messagesSubject[totalMessages]);
        ++totalMessages;
        cb(null, chunk);
      });

      transform.on('finish', function() {
        assert.equal(totalMessages, 4, 'should receive 4 messages from outbox');
        done();
      });

      stream.pipe(transform);
    });
  });

});
