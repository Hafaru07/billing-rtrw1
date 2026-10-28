const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRupiahAmountFromNotification, extractPaymentNotificationText } = require('../services/paymentNotificationParser');

const jagoNotification = 'Jago - Kamu menambahkan Rp1.807 ke Kantong . Klik di sini untuk lihat cara tambahin uang ke Jago.';

test('Jago incoming notification parses Rp1.807 as 1807', () => {
  assert.equal(parseRupiahAmountFromNotification(jagoNotification), 1807);
});

test('nested notification payload is extracted without including the webhook secret', () => {
  const text = extractPaymentNotificationText({
    body: { payload: { notification: { title: 'Jago', text: 'Kamu menambahkan Rp1.807 ke Kantong .' } }, secret_key: 'hidden-secret' },
    query: { secret_key: 'hidden-query-secret' }
  });
  assert.equal(text, 'Jago Kamu menambahkan Rp1.807 ke Kantong .');
  assert.equal(parseRupiahAmountFromNotification(text), 1807);
  assert.equal(text.includes('hidden-secret'), false);
});

test('plain text notification body is supported', () => {
  const text = extractPaymentNotificationText({ body: jagoNotification, rawBody: jagoNotification });
  assert.equal(text, jagoNotification);
  assert.equal(parseRupiahAmountFromNotification(text), 1807);
});

test('empty MacroDroid POST has no text to parse', () => {
  assert.equal(extractPaymentNotificationText({ body: {}, query: { secret_key: 'hidden-secret' }, rawBody: '' }), '');
  assert.equal(parseRupiahAmountFromNotification(''), null);
});

test('outgoing and quoted invoice notifications are not treated as incoming payments', () => {
  assert.equal(parseRupiahAmountFromNotification('Kamu membayar Rp1.807 ke toko.'), null);
  assert.equal(parseRupiahAmountFromNotification('Tagihan manual Rp1.807 telah diterima dari pelanggan.'), null);
});
