var simpleParser = require('../../main.js').simpleParser;
var fs = require('fs');
var assert = require('assert');

describe('Simple-parser', function() {

  it('Parse message', function(done) {
    simpleParser(fs.createReadStream(__dirname + '/../fixtures/nodemailer.eml'), (err, mail) => {
      assert(!err);
      assert(mail);
      assert.equal(mail.attachments.length, 4);
      assert.equal(mail.attachments[2].checksum, '2822cbcf68de083b96ac3921d0e308a2');
      assert(mail.html.indexOf('data:image/png;base64,iVBORw0KGgoAAAANSU') >= 0);
      assert.equal(mail.subject, 'Nodemailer is unicode friendly ✔ (1476358788189)');
      assert.deepEqual(mail.to, {
        value: [
          // keep indent
          {
            address: 'andris+123@kreata.ee',
            name: 'Andris Reinman'
          },
          {
            address: 'andris.reinman@gmail.com',
            name: ''
          }
        ],
        html: '<span class="mp_address_group"><span class="mp_address_name">Andris Reinman</span> &lt;<a href="mailto:andris+123@kreata.ee" class="mp_address_email">andris+123@kreata.ee</a>&gt;</span>, <span class="mp_address_group"><a href="mailto:andris.reinman@gmail.com" class="mp_address_email">andris.reinman@gmail.com</a></span>',
        text: 'Andris Reinman <andris+123@kreata.ee>, andris.reinman@gmail.com'
      });
      return done();
    });
  });

  it('Parse message with large plaintext content', function(done) {
    simpleParser(fs.createReadStream(__dirname + '/../fixtures/large_text.eml'), (err, mail) => {
      assert(!err);
      assert(mail);
      assert(mail.textAsHtml);
      assert(mail.text);
      assert(!mail.html);

      return done();
    });
  });

});
