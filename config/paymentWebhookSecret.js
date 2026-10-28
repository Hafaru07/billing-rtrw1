const crypto = require('crypto');

const LEGACY_DEFAULT_SECRET = 'billing-rtrw-secret-key';

function getPaymentWebhookSecret(settings = {}, env = process.env) {
  const envSecret = String(env.MY_WEBHOOK_SECRET || '').trim();
  if (envSecret && envSecret !== LEGACY_DEFAULT_SECRET) return envSecret;

  const settingsSecret = String(settings.webhook_secret || '').trim();
  return settingsSecret && settingsSecret !== LEGACY_DEFAULT_SECRET ? settingsSecret : '';
}

function matchesPaymentWebhookSecret(candidate, expected) {
  if (!expected || (typeof candidate !== 'string' && typeof candidate !== 'number')) return false;
  const received = String(candidate).trim();
  if (!received) return false;

  const receivedHash = crypto.createHash('sha256').update(received).digest();
  const expectedHash = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(receivedHash, expectedHash);
}

function hasMatchingPaymentWebhookSecret(expected, candidates) {
  return Boolean(expected) && candidates.some(([, value]) => matchesPaymentWebhookSecret(value, expected));
}

function buildPaymentWebhookUrl(baseUrl, secret) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const path = '/api/webhook/v1/payment-notif';
  return `${base}${path}${secret ? `?secret_key=${encodeURIComponent(secret)}` : ''}`;
}

module.exports = { getPaymentWebhookSecret, hasMatchingPaymentWebhookSecret, buildPaymentWebhookUrl };
