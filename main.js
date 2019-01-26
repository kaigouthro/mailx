
var Transport = require("./lib/transport");
var Store = require("./lib/store");
var Message = require("./lib/message");
var Parser = require("./lib/mailParser");


module.exports = {
  transport: function(host, port, login, password) {
    return new Transport(host, port, login, password);
  },
  store: function(protocol, host, port, login, password, options) {
    return new Store(protocol, host, port, login, password, options);
  },
  mailParser: Parser.MailParser,
  simpleParser: Parser.simpleParser,
  message: Message.create,
  parse: Message.createFromRaw
};
