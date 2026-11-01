const crypto = require('crypto');
const { getSetting } = require('../config/settingsManager');

function equalSecrets(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyFonnteWebhook(req, res, next) {
  const expected = String(process.env.FONNTE_WEBHOOK_SECRET || getSetting('fonnte_webhook_secret', '') || '').trim();
  if (!expected) return res.status(503).json({ status: false, error: 'Webhook Fonnte belum dikonfigurasi' });
  const body = req.body || {};
  const provided = body.secret || body.secret_key || req.get('x-webhook-secret');
  if (!equalSecrets(provided, expected)) return res.status(403).json({ status: false, error: 'Forbidden' });
  next();
}

function verifyMetaWebhook(req, res, next) {
  const secret = String(process.env.META_APP_SECRET || getSetting('meta_app_secret', '') || '').trim();
  if (!secret) return res.status(503).send('Webhook Meta belum dikonfigurasi');
  const signature = String(req.get('x-hub-signature-256') || '');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
  if (!equalSecrets(signature, expected)) return res.sendStatus(403);
  next();
}

module.exports = { equalSecrets, verifyFonnteWebhook, verifyMetaWebhook };
