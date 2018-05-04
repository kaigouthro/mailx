var mailx = require('./../../main');
var asynk = require('asynk');
var _ = require('lodash');

var mails = {
  inbox: [
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
  outbox: [
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
  beatbox: [
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject8',
      text: 'text8'
    },
    {
      from: {name: 'me', address: 'me@localhost'},
      to: {name: 'you', address: 'you@localhost'},
      subject: 'subject9',
      text: 'text9'
    }
  ]
};

module.exports = {
  fillMails: function(boxNames, cb) {
    var self = this;
    if (_.isString(boxNames)) {
      boxNames = [boxNames];
    }
    var transport = mailx.transport('172.18.0.10', 2525);
    var store = mailx.store('imap', '172.18.0.10', 143, 'test', 'pass');
    store.connect(function(err) {
      if (err) {
        return cb(err);
      }
      asynk.each(boxNames, function(boxName, callback) {
        self.fillBox(transport, store, boxName, callback);
      }).serie().fail(cb).done(cb);
    });
  },

  fillBox: function(transport, store, boxName, cb) {
    if (!mails[boxName.toLowerCase()]) {
      return cb(new Error('Unknown box : ' + boxName));
    }
    asynk.each(mails[boxName.toLowerCase()], function(mail, callback) {
      var message = mailx.message();
      message.setFrom(mail.from.name, mail.from.address);
      message.addTo(mail.to.name, mail.to.address);
      message.setSubject(mail.subject);
      message.setText(mail.text);
      transport.send(message, function(err, result) {
        if (err) {
          return callback(err);
        }
        callback();
      });
    }).serie().fail(cb).done(function() {
      store.openBox(boxName, function(err) {
        if (err) {
          return cb(err);
        }
        store.move('*', boxName, function(err) {
          if (err) {
            return cb(err);
          }
          return cb();
        });
      });
    });
  },

  emptyMails: function(boxNames, cb) {
    var self = this;
    if (_.isString(boxNames)) {
      boxNames = [boxNames];
    }
    var transport = mailx.transport('172.18.0.10', 2525);
    var store = mailx.store('imap', '172.18.0.10', 143, 'test', 'pass');
    store.connect(function(err) {
      if (err) {
        return cb(err);
      }
      asynk.each(boxNames, function(boxName, callback) {
        store.openBox(boxName, function(err) {
          if (err) {
            return callback(err);
          }
          store.deleteMessage('*', callback);
        });
      }).serie().fail(cb).done(cb);
    });
  },
}
