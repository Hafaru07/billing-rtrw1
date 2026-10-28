const test = require('node:test');
const assert = require('node:assert/strict');
const { getPaymentWebhookSecret, hasMatchingPaymentWebhookSecret, buildPaymentWebhookUrl } = require('../config/paymentWebhookSecret');

test('environment secret takes precedence over settings after an update', () => {
  const settings = { webhook_secret: 'old-settings-secret' };
  const env = { MY_WEBHOOK_SECRET: 'new-env-secret' };
  assert.equal(getPaymentWebhookSecret(settings, env), 'new-env-secret');
  assert.equal(getPaymentWebhookSecret(settings, {}), 'old-settings-secret');
});

test('public legacy default is never accepted as a configured secret', () => {
  const settings = { webhook_secret: 'billing-rtrw-secret-key' };
  assert.equal(getPaymentWebhookSecret(settings, {}), '');
  assert.equal(hasMatchingPaymentWebhookSecret('', [['query.secret_key', 'billing-rtrw-secret-key']]), false);
  assert.equal(hasMatchingPaymentWebhookSecret('real-secret', [['query.secret_key', 'billing-rtrw-secret-key']]), false);
});

test('valid query secret works even when body contains an old secret', () => {
  const candidates = [['body.secret_key', 'old-secret'], ['query.secret_key', 'new-secret']];
  assert.equal(hasMatchingPaymentWebhookSecret('new-secret', candidates), true);
  assert.equal(hasMatchingPaymentWebhookSecret('different-secret', candidates), false);
});

test('copied webhook URL safely encodes special characters in the secret', () => {
  const url = buildPaymentWebhookUrl('https://portal.example.test/', 'abc&def?ghi#jkl');
  assert.equal(new URL(url).searchParams.get('secret_key'), 'abc&def?ghi#jkl');
  assert.equal(buildPaymentWebhookUrl('', ''), '/api/webhook/v1/payment-notif');
});
