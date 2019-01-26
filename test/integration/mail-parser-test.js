var MailParser = require('../../main.js').mailParser;
var iconv = require('iconv-lite');
var fs = require('fs');
var assert = require('assert');

describe('General tests', function() {

  it('Many chunks', function(done) {
    var encodedText = 'Content-Type: text/plain; charset=utf-8\r\n\r\nÕÄ\r\nÖÜ'; // \r\nÕÄÖÜ
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);

    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄ\nÖÜ');
      return done();
    });

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.end();
  });

  it('Many chunks - split line endings', function(done) {
    var chunks = ['Content-Type: text/plain; charset=utf-8\r', '\nSubject: Hi Mom\r\n\r\n', 'hello'];
    var mailparser = new MailParser();

    var writeNextChunk = function() {
      var chunk = chunks.shift();
      if (chunk) {
        mailparser.write(chunk, 'utf8');
        if (typeof setImmediate === 'function') {
          setImmediate(writeNextChunk);
        } else {
          process.nextTick(writeNextChunk);
        }
      } else {
        mailparser.end();
      }
    };

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'hello');
      return done();
    });

    if (typeof setImmediate === 'function') {
      setImmediate(writeNextChunk);
    } else {
      process.nextTick(writeNextChunk);
    }
  });

  it('Headers only', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.end(mail);
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.headers.get('subject'), 'ÕÄÖÜ');
      return done();
    });
  });

  it('Body only', function(done) {
    var encodedText = '\r\n===';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.end(mail);
    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, '===');
      return done();
    });
  });

  it('Different line endings', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\nSubject: ÕÄÖÜ\n\n1234\r\nÕÄÖÜ\r\nÜÖÄÕ\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.headers.get('subject'), 'ÕÄÖÜ');
      assert.equal(mailparser.text, '1234\nÕÄÖÜ\nÜÖÄÕ\n1234');
      return done();
    });
    mailparser.end(mail);
  });

  it('Headers event', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      'X-Test: =?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?=\r\n' +
      'Subject: ABCDEF\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment; filename="test.pdf"\r\n' +
      '\r\n' +
      'AAECAwQFBg==\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('headers', headers => {
      assert.equal(headers.get('subject'), 'ABCDEF');
      assert.equal(headers.get('x-test'), '=?UTF-8?Q?=C3=95=C3=84?= =?UTF-8?Q?=C3=96=C3=9C?=');
    });

    mailparser.on('data', data => {
      if (data && data.release) {
        data.content.on('data', () => false);
        data.content.on('end', () => false);
        data.release();
      }
    });
    mailparser.on('end', () => {
      return done();
    });
    mailparser.end(mail);
  });

  it('No priority', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.headers.has('priority'), false);
      return done();
    });
    mailparser.end(mail);
  });

  it('MS Style priority', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nSubject: ÕÄÖÜ\nX-Priority: 1 (Highest)\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.headers.get('priority'), 'high');
      return done();
    });
    mailparser.end(mail);
  });

  it('Single reference', function(done) {
    var encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.headers.get('references'), '<mail1>');
      return done();
    });
    mailparser.end(mail);
  });

  it('Multiple reference values', function(done) {
    var encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\n    <mail2> <mail3>\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.references, ['<mail1>', '<mail2>', '<mail3>']);
      return done();
    });
    mailparser.end(mail);
  });

  it('Multiple reference fields', function(done) {
    var encodedText = 'Content-type: text/plain\r\nReferences: <mail1>\nReferences: <mail3>\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.references, ['<mail1>', '<mail3>']);
      return done();
    });
    mailparser.end(mail);
  });

  it('Single in-reply-to', function(done) {
    var encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.inReplyTo, '<mail1>');
      return done();
    });
    mailparser.end(mail);
  });

  it('Multiple in-reply-to values', function(done) {
    var encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\n    <mail2> <mail3>\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.inReplyTo, '<mail1> <mail2> <mail3>');
      return done();
    });
    mailparser.end(mail);
  });

  it('Multiple in-reply-to fields', function(done) {
    var encodedText = 'Content-type: text/plain\r\nin-reply-to: <mail1>\nin-reply-to: <mail3>\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.inReplyTo, '<mail3>');
      return done();
    });
    mailparser.end(mail);
  });

  it('Reply To address', function(done) {
    var encodedText = 'Reply-TO: andris <andris@disposebox.com>\r\nSubject: ÕÄÖÜ\n\r\n1234';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.replyTo.value, [{
        name: 'andris',
        address: 'andris@disposebox.com'
      }]);
      return done();
    });
    mailparser.end(mail);
  });

});

describe('Text encodings', function() {

  it('Plaintext encoding: Default', function(done) {
    var encodedText = [13, 10, 213, 196, 214, 220]; // \r\nÕÄÖÜ
    var mail = Buffer.from(encodedText);
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Plaintext encoding: Header defined', function(done) {
    var encodedText = 'Content-Type: TEXT/PLAIN; CHARSET=UTF-8\r\n\r\nÕÄÖÜ';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('HTML encoding: Header defined', function(done) {
    var encodedText = 'Content-Type: text/html; charset=iso-UTF-8\r\n\r\nÕÄÖÜ';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.html, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Mime Words', function(done) {
    var encodedText =
      'Content-type: text/plain; charset=utf-8\r\n' +
      'From: =?utf-8?q?_?= <sender@email.com>\r\n' +
      'To: =?ISO-8859-1?Q?Keld_J=F8rn_Simonsen?= <to@email.com>\r\n' +
      'Subject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
      assert.equal(mailparser.from.value[0].name, ' ');
      assert.equal(mailparser.to.value[0].name, 'Keld Jørn Simonsen');
      return done();
    });
    mailparser.end(mail);
  });

});

describe('Binary attachment encodings', function() {

  it('Quoted-Printable', function(done) {
    var encodedText = 'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '0,1,2,3,253,254,255');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Base64', function(done) {
    var encodedText = 'Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\nAAECA/3+/w==';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => {
          chunks.push(chunk)});
        data.content.on('end', () => {
          data.val = Buffer.concat(chunks);
          attachments.push(data);
          data.release();
        });
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(Array.prototype.slice.apply((attachments[0].val && attachments[0].val) || []).join(','), '0,1,2,3,253,254,255');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('8bit', function(done) {
    var encodedText = 'Content-Type: application/octet-stream\r\n\r\nÕÄÖÜ';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(Array.prototype.slice.apply((attachments[0].content && attachments[0].content) || []).join(','), '195,149,195,132,195,150,195,156');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

});

describe('Attachment Content-Id', function() {

  it('Default', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert(!attachments[0].contentId);
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Defined', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
      'Content-Id: <test@localhost>\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].contentId, '<test@localhost>');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });



});

describe('Attachment filename', function() {

  it('Content-Disposition filename*', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      'Content-Disposition: attachment; filename="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Disposition filename*X', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      'Content-Disposition: attachment;\r\n' +
      '    filename*0=OA;\r\n' +
      '    filename*1=U;\r\n' +
      '    filename*2=.txt\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'OAU.txt');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Disposition filename*X*', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      'Content-Disposition: attachment;\r\n' +
      '    filename*0*=UTF-8\'\'%C3%95%C3%84;\r\n' +
      '    filename*1*=%C3%96%C3%9C\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Disposition filename*X* mixed', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      'Content-Disposition: attachment;\r\n' +
      '    filename*0*=UTF-8\'\'%C3%95%C3%84;\r\n' +
      '    filename*1*=%C3%96%C3%9C;\r\n' +
      '    filename*2=.txt\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ.txt');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Type name', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream; name="=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?="\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Type unknown; name', function(done) {
    var encodedText = 'Content-Type: unknown; name="test"\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].filename, 'test');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Type name*', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream;\r\n' +
      '    name*=UTF-8\'\'%C3%95%C3%84%C3%96%C3%9C\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Content-Type name*X*', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream;\r\n' +
      '    name*0*=UTF-8\'\'%C3%95%C3%84;\r\n' +
      '    name*1*=%C3%96%C3%9C\r\n' +
      'Content-Transfer-Encoding: QUOTED-PRINTABLE\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'ÕÄÖÜ');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Multiple filenames - Same', function(done) {
    var encodedText =
      'Content-Type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream; name="test.txt"\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream; name="test.txt"\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'test.txt');
        assert.equal(attachments && attachments[1] && attachments[1].content && attachments[1].filename, 'test.txt');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Multiple filenames - Different', function(done) {
    var encodedText =
      'Content-Type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream; name="test.txt"\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(!attachments[0].filename, true);
        assert.equal(attachments[1].filename, 'test.txt');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

  it('Filename with semicolon', function(done) {
    var encodedText =
      'Content-Type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Disposition: attachment; filename="hello;world;test.txt"\r\n' +
      '\r\n' +
      '=00=01=02=03=FD=FE=FF\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });
    mailparser.on('end', () => {
      setTimeout(function() {
        assert.equal(attachments[0].content && attachments[0].filename, 'hello;world;test.txt');
        return done();
      }, 200);
    });
    mailparser.end(mail);
  });

});

describe('Plaintext format', function() {

  it('Default', function(done) {
    var encodedText = 'Content-Type: text/plain;\r\n\r\nFirst line \r\ncontinued';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'First line \ncontinued');
      return done();
    });
    mailparser.end(mail);
  });

  it('Flowed', function(done) {
    var encodedText = 'Content-Type: text/plain; format=flowed\r\n\r\nFirst line \r\ncontinued \r\nand so on';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'First line continued and so on');
      return done();
    });
    mailparser.end(mail);
  });

  it('Flowed Signature', function(done) {
    var encodedText = 'Content-Type: text/plain; format=flowed\r\n\r\nHow are you today?\r\n\r\n-- \r\nSignature\r\n';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'How are you today?\n-- \nSignature\n');
      return done();
    });
    mailparser.end(mail);
  });

  it('Fixed', function(done) {
    var encodedText = 'Content-Type: text/plain; format=fixed\r\n\r\nFirst line \r\ncontinued \r\nand so on';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'First line \ncontinued \nand so on');
      return done();
    });
    mailparser.end(mail);
  });

  it('DelSp', function(done) {
    var encodedText = 'Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\nFirst line \r\ncontinued \r\nand so on';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();
    mailparser.on('data', () => false);

    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'First linecontinuedand so on');
      return done();
    });
    mailparser.end(mail);
  });

});

describe('Transfer encoding', function() {

  it('Quoted-Printable Default charset', function(done) {
    var encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=D5=C4=D6=DC';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Quoted-Printable UTF-8', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n=C3=95=C3=84=C3=96=C3=9C';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Base64 Default charset', function(done) {
    var encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n1cTW3A==';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Base64 UTF-8', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\nw5XDhMOWw5w=';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Mime Words', function(done) {
    var encodedText =
      'Content-type: text/plain; charset=utf-8\r\nSubject: =?iso-8859-1?Q?Avaldu?= =?iso-8859-1?Q?s_lepingu_?=\r\n =?iso-8859-1?Q?l=F5petamise?= =?iso-8859-1?Q?ks?=\r\n';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.subject, 'Avaldus lepingu lõpetamiseks');
      return done();
    });
    mailparser.end(mail);
  });

  it('8bit Default charset', function(done) {
    var encodedText = 'Content-type: text/plain\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ';
    var textmap = encodedText.split('').map(chr => chr.charCodeAt(0));
    var mail = Buffer.from(textmap);
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('8bit UTF-8', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\nÕÄÖÜ';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Invalid Quoted-Printable', function(done) {
    var encodedText = 'Content-type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: QUOTED-PRINTABLE\r\n\r\n==C3==95=C3=84=C3=96=C3=9C=';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, '=�=�ÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('gb2312 mime words', function(done) {
    var encodedText = 'From: =?gb2312?B?086yyZjl?= user@ldkf.com.tw\r\n\r\nBody';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.deepEqual(mailparser.from.value, [{
        address: 'user@ldkf.com.tw',
        name: '游采樺'
      }]);
      return done();
    });
    mailparser.end(mail);
  });

  it('Valid Date header', function(done) {
    var encodedText = 'Date: Wed, 08 Jan 2014 09:52:26 -0800\r\n\r\n1cTW3A==';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.date.toISOString(), '2014-01-08T17:52:26.000Z');
      return done();
    });
    mailparser.end(mail);
  });

  it('Invalid Date header', function(done) {
    var encodedText = 'Date: zzzzz\r\n\r\n1cTW3A==';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert(!mail.date);
      return done();
    });
    mailparser.end(mail);
  });

  it('Missing Date header', function(done) {
    var encodedText = 'Subject: test\r\n\r\n1cTW3A==';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert(!mail.date);
      return done();
    });
    mailparser.end(mail);
  });

});

describe('Multipart content', function() {

  it('Simple', function(done) {
    var encodedText = 'Content-type: multipart/mixed; boundary=ABC\r\n\r\n--ABC\r\nContent-type: text/plain; charset=utf-8\r\n\r\nÕÄÖÜ\r\n--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Nested', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-type: multipart/related; boundary=DEF\r\n' +
      '\r\n' +
      '--DEF\r\n' +
      'Content-type: text/plain; charset=utf-8\r\n' +
      '\r\n' +
      'ÕÄÖÜ\r\n' +
      '--DEF--\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Inline text (Sparrow)', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: text/plain; charset="utf-8"\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n' +
      'Content-Disposition: inline\r\n' +
      '\r\n' +
      'ÕÄÖÜ\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ');
      return done();
    });
    mailparser.end(mail);
  });

  it('Different Levels', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-type: text/html; charset=utf-8\r\n' +
      '\r\n' +
      'ÕÄÖÜ2\r\n' +
      '--ABC\r\n' +
      'Content-type: multipart/related; boundary=DEF\r\n' +
      '\r\n' +
      '--DEF\r\n' +
      'Content-type: text/plain; charset=utf-8\r\n' +
      '\r\n' +
      'ÕÄÖÜ1\r\n' +
      '--DEF--\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var mailparser = new MailParser();

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, 'ÕÄÖÜ2\nÕÄÖÜ1');
      assert.equal(mailparser.html, 'ÕÄÖÜ2<br/>\n<p>&Otilde;&Auml;&Ouml;&Uuml;1</p>');
      return done();
    });
    mailparser.end(mail);
  });

});

describe('Attachment info', function() {

  it('Included integrity', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      '=00=01=02=03=04=05=06\r\n' +
      '--ABC--';
    var expectedHash = '9aa461e1eca4086f9230aa49c90b0c61';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('end', () => {
      assert.equal(attachments[0].checksum, expectedHash);
      assert.equal(attachments[0].size, 7);
      return done();
    });
    mailparser.end();
  });

  it('Stream integrity base64', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      'AAECAwQFBg==\r\n' +
      '--ABC--';
    var expectedHash = '9aa461e1eca4086f9230aa49c90b0c61';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    mailparser.on('end', () => {
      assert.equal(attachments[0].checksum, expectedHash);
      assert.equal(attachments[0].size, 7);
      return done();
    });
    mailparser.end();
  });

  it('Stream integrity - 8bit', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      'ÕÄ\r\n' +
      'ÖÜ\r\n' +
      '--ABC--';
    var expectedHash = 'cad0f72629a7245dd3d2cbf41473e3ca';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('end', () => {
      assert.equal(attachments[0].checksum, expectedHash);
      assert.equal(attachments[0].size, 10);
      return done();
    });
    mailparser.end();
  });

  it('Stream integrity - binary, non utf-8', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      'ÕÄ\r\n' +
      'ÖÜ\r\n' +
      'ŽŠ\r\n' +
      '--ABC--';
    var expectedHash = '34bca86f8cc340bbd11446ee16ee3cae';
    var mail = iconv.encode(encodedText, 'iso-8859-13');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('end', () => {
      assert.equal(attachments[0].checksum, expectedHash);
      assert.equal(attachments[0].size, 10);
      return done();
    });
    mailparser.end();
  });

  it('Stream integrity - qp, non utf-8', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream; charset=iso-8859-13\r\n' +
      'Content-Transfer-Encoding: quoted-printable\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      '=d5=c4\r\n' +
      '=d6=dc\r\n' +
      '=de=d0\r\n' +
      '--ABC--';
    var expectedHash = '34bca86f8cc340bbd11446ee16ee3cae';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('end', () => {
      assert.equal(attachments[0].checksum, expectedHash);
      assert.equal(attachments[0].size, 10);
      return done();
    });
    mailparser.end();
  });

  it('Attachment in root node', function(done) {
    var encodedText =
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: 8bit\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      'ÕÄ\r\n' +
      'ÖÜ';
    var expectedHash = 'cad0f72629a7245dd3d2cbf41473e3ca';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser({
      streamAttachments: true
    });

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('end', () => {
      assert.equal(attachments[0].checksum, expectedHash);
      assert.equal(attachments[0].size, 10);
      return done();
    });
    mailparser.end();
  });

  it('Stream multiple attachments', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      'AAECAwQFBg==\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment\r\n' +
      '\r\n' +
      'AAECAwQFBg==\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment; filename="test.txt"\r\n' +
      '\r\n' +
      'AAECAwQFBg==\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');

    var attachments = [];
    var mailparser = new MailParser({
      streamAttachments: true
    });

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        assert(data);
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    mailparser.on('end', () => {
      assert.equal(3, attachments.length);
      return done();
    });
    mailparser.end(mail);
  });

  it('Detect Content-Type by filename', function(done) {
    var encodedText =
      'Content-type: multipart/mixed; boundary=ABC\r\n' +
      '\r\n' +
      '--ABC\r\n' +
      'Content-Type: application/octet-stream\r\n' +
      'Content-Transfer-Encoding: base64\r\n' +
      'Content-Disposition: attachment; filename="test.pdf"\r\n' +
      '\r\n' +
      'AAECAwQFBg==\r\n' +
      '--ABC--';
    var mail = Buffer.from(encodedText, 'utf-8');
    var attachments = [];
    var mailparser = new MailParser();

    mailparser.on('data', data => {
      if (data.type === 'attachment') {
        assert(data);
        var chunks = [];
        data.content.on('data', chunk => chunks.push(chunk));
        data.content.on('end', () => {
          data.content = Buffer.concat(chunks);
          data.release();
        });
        attachments.push(data);
      }
    });

    mailparser.write(mail);
    mailparser.on('end', () => {
      assert.equal(attachments[0].contentType, 'application/pdf');
      return done();
    });
    mailparser.end();
  });

});

describe('Advanced nested HTML', function() {

  it('Advanced nested HTML', function(done) {
    var mail = fs.readFileSync(__dirname + '/../fixtures/nested.eml');
    var mailparser = new MailParser();

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, '\nDear Sir,\n\nGood evening.\n\n\n\n\n\n\n\nThe footer\n');
      assert.equal(mailparser.html, '<p>Dear Sir</p>\n<p>Good evening.</p>\n<p></p><br/>\n<p>The footer</p>\n');
      return done();
    });
    mailparser.end();
  });

});

describe('Additional text', function() {

  it('Additional text', function(done) {
    var mail = fs.readFileSync(__dirname + '/../fixtures/mixed.eml');
    var mailparser = new MailParser();

    for (var i = 0, len = mail.length; i < len; i++) {
      mailparser.write(Buffer.from([mail[i]]));
    }

    mailparser.on('data', () => false);
    mailparser.on('end', () => {
      assert.equal(mailparser.text, '\nThis e-mail message has been scanned for Viruses and Content and cleared\n\nGood Morning;\n\n');
      assert.equal(
        mailparser.html,
        '<HTML><HEAD>\n</HEAD><BODY> \n\n<HR>\nThis e-mail message has been scanned for Viruses and Content and cleared\n<HR>\n</BODY></HTML>\n<br/>\n<p>Good Morning;</p>'
      );
      return done();
    });
    mailparser.end();
  });

});
