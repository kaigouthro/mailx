var mailx = require('./../../main');
var asynk = require('asynk');
var _ = require('lodash');

var mails = {
  INBOX: [
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject1',
      text: 'text1'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject2',
      text: 'text2'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject3',
      text: 'text3'
    }
  ],
  OUTBOX: [
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject4',
      text: 'text4'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject5',
      text: 'text5'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject6',
      text: 'text6'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject7',
      text: 'text7'
    }
  ],
  BEATBOX: [
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'test@localhost'},
      subject: 'subject8',
      text: 'text8'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'test@localhost'},
      subject: 'subject9',
      text: 'text9'
    }
  ]
};

module.exports = {
  fillMails: function(boxNames, transport, store, cb) {
    // return cb();
    var self = this;
    if (_.isString(boxNames)) {
      boxNames = [boxNames];
    }
    store.connect(function(err) {
      if (err) {
        return cb(err);
      }
      asynk.each(boxNames, function(boxName, callback) {
        self.fillBox(transport, store, boxName, callback);
      }).serie().asCallback(function(err) {
        if (err) {
          return cb(err);
        }
        store.close(cb);
      });
    });
  },

  fillBox: function(transport, store, boxName, cb) {
    if (!mails[boxName]) {
      return cb(new Error('Unknown box : ' + boxName));
    }
    asynk.each(mails[boxName], function(mail, callback) {
      var message = mailx.message();
      message.setFrom(mail.from.name, mail.from.address);
      message.addTo(mail.to.name, mail.to.address);
      message.setSubject(mail.subject);
      message.setText(mail.text);
      transport.send(message, function(err, result) {
        if (err) {
          return callback(err);
        }
        setTimeout(function() {
          callback();
        }, 100);
      });
    }).serie().fail(cb).done(function() {
      var flag = false;

      var check = function(ok) {
        if (ok) {
          store.move('1:*', boxName, 'INBOX', function(err) {
            if (err) {
              return cb(err);
            }
            return cb();
          });
        } else {
          store.getInboxMessages(1, function(err, messages) {
            if (err) {
              return cb(err);
            }
            if (messages && messages.length === mails[boxName].length) {
              return check(true);
            }
            if (messages && messages.length > mails[boxName].length) {
              return cb(new Error('Too many mails in box (probably remnants from previous tests). AfterEach() should clean it, just restart the tests'));
            }
            check();
          });
        }
      };
      if (store.constructor && store.constructor.name === 'PopStore') {
        store.close(function(err) {
          if (err) {
            return cb(err);
          }
          setTimeout(function() {
            store.connect(function(err) {
              if (err) {
                return cb(err);
              }
              check();
            });
          }, 1000);
        });
      } else {
        check();
      }
    });
  },

  emptyMails: function(boxNames, transport, store, cb) {
    var self = this;
    if (_.isString(boxNames)) {
      boxNames = [boxNames];
    }
    store.connect(function(err) {
      if (err) {
        return cb(err);
      }
      asynk.each(boxNames, function(boxName, callback) {
        store.openBox(boxName, function(err) {
          if (err) {
            return callback(err);
          }
          store.deleteMessage('1:*', function(err) {
            if (err) {
              return callback(err);
            }
            store.expunge(callback);
          });
        });
      }).serie().asCallback(function(err) {
        if (err) {
          return cb(err);
        }
        store.close(cb);
      });
    });
  },
}
