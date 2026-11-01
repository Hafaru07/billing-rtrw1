const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { hashPassword, verifyPassword, migrateStaffPasswords } = require('../services/staffPassword');
const SqliteSessionStore = require('../services/sqliteSessionStore');
const { resolveBackupFile } = require('../services/backupService');
const { verifyFonnteWebhook, verifyMetaWebhook } = require('../middleware/webhookAuth');
const { getAdminUsername, verifyAdminCredentials } = require('../config/adminCredentials');
const { parseCustomerWorkbook } = require('../services/parseCustomerWorkbook');
const { exportRowsToXlsx } = require('../services/excelWorkbook');
const settingsManager = require('../config/settingsManager');
const fs = require('node:fs');
const QRCode = require('qrcode');
const qrisUtil = require('../utils/qrisUtil');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    sendStatus(code) { this.statusCode = code; return this; }
  };
}

test('staff passwords migrate to salted hashes and still authenticate', () => {
  const db = new Database(':memory:');
  for (const table of ['technicians', 'cashiers', 'collectors', 'agents']) {
    db.exec(`CREATE TABLE ${table} (id INTEGER PRIMARY KEY, password TEXT)`);
    db.prepare(`INSERT INTO ${table} (password) VALUES (?)`).run('old-password');
  }
  migrateStaffPasswords(db);
  for (const table of ['technicians', 'cashiers', 'collectors', 'agents']) {
    const saved = db.prepare(`SELECT password FROM ${table}`).get().password;
    assert.match(saved, /^scrypt\$/);
    assert.equal(verifyPassword('old-password', saved), true);
    assert.equal(verifyPassword('wrong-password', saved), false);
  }
  assert.notEqual(hashPassword('same-password'), hashPassword('same-password'));
  db.close();
});

test('backup names cannot escape backup directory', () => {
  assert.match(resolveBackupFile('settings_20260101.json'), /settings_20260101\.json$/);
  for (const name of ['../settings.json', '..\\settings.json', '.', '..', 'folder/file.db']) {
    assert.throws(() => resolveBackupFile(name));
  }
});

test('session data survives store recreation and expires', () => {
  const db = new Database(':memory:');
  const store = new SqliteSessionStore(db);
  const value = { user: 7, cookie: { expires: new Date(Date.now() + 60000).toISOString() } };
  store.set('session-id', value, (error) => assert.ifError(error));
  store.get('session-id', (error, saved) => {
    assert.ifError(error);
    assert.equal(saved.user, 7);
  });
  store.touch('session-id', { cookie: { expires: new Date(Date.now() - 1000).toISOString() } });
  store.get('session-id', (error, saved) => {
    assert.ifError(error);
    assert.equal(saved, null);
  });
  clearInterval(store.timer);
  db.close();
});

test('webhooks reject forged requests and accept valid secrets', () => {
  const oldFonnte = process.env.FONNTE_WEBHOOK_SECRET;
  const oldMeta = process.env.META_APP_SECRET;
  try {
    process.env.FONNTE_WEBHOOK_SECRET = 'test-fonnte-secret';
    process.env.META_APP_SECRET = 'test-meta-secret';
    const fonnteReq = { body: { secret: 'wrong' }, get: () => '' };
    let nextCalled = false;
    const rejectedFonnte = response();
    verifyFonnteWebhook(fonnteReq, rejectedFonnte, () => { nextCalled = true; });
    assert.equal(rejectedFonnte.statusCode, 403);
    assert.equal(nextCalled, false);
    fonnteReq.body.secret = 'test-fonnte-secret';
    verifyFonnteWebhook(fonnteReq, response(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);

    const rawBody = '{"object":"whatsapp_business_account"}';
    const signature = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET).update(rawBody).digest('hex');
    const metaReq = { rawBody, get: (name) => name === 'x-hub-signature-256' ? signature : '' };
    nextCalled = false;
    verifyMetaWebhook(metaReq, response(), () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    metaReq.get = () => 'sha256=bad';
    const rejected = response();
    verifyMetaWebhook(metaReq, rejected, () => {});
    assert.equal(rejected.statusCode, 403);
  } finally {
    if (oldFonnte === undefined) delete process.env.FONNTE_WEBHOOK_SECRET;
    else process.env.FONNTE_WEBHOOK_SECRET = oldFonnte;
    if (oldMeta === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = oldMeta;
  }
});

test('default administrator password is refused', () => {
  const old = process.env.ADMIN_PASSWORD;
  try {
    process.env.ADMIN_PASSWORD = 'admin123';
    assert.equal(verifyAdminCredentials(getAdminUsername(), 'admin123'), false);
    process.env.ADMIN_PASSWORD = 'test-long-unique-password';
    assert.equal(verifyAdminCredentials(getAdminUsername(), 'test-long-unique-password'), true);
  } finally {
    if (old === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = old;
  }
});

test('unreadable settings never fall back to a public token secret', () => {
  const originalReadFileSync = fs.readFileSync;
  const oldSecret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    fs.readFileSync = (file, ...args) => {
      if (String(file).endsWith('settings.json')) throw new Error('test settings unavailable');
      return originalReadFileSync(file, ...args);
    };
    const first = settingsManager.getSettings().session_secret;
    const second = settingsManager.getSettings().session_secret;
    assert.equal(first, second);
    assert.ok(first.length >= 32);
    assert.notEqual(first, 'rahasia-api-pelanggan-alijaya-default');
  } finally {
    fs.readFileSync = originalReadFileSync;
    if (oldSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = oldSecret;
  }
});

test('Excel import parses in a worker and rejects invalid input', async () => {
  const buffer = await exportRowsToXlsx([{ Nama: 'Pelanggan Uji', Telepon: '08123456789' }], 'Pelanggan');
  const rows = await parseCustomerWorkbook(buffer);
  assert.equal(rows[0].Nama, 'Pelanggan Uji');
  await assert.rejects(parseCustomerWorkbook(Buffer.alloc(0)));
});

test('QR image conversion and decoding survive the image library change', async () => {
  const payload = '0002010102115204000053033605802ID6304A1B2';
  const png = await QRCode.toBuffer(payload, { type: 'png', width: 420, margin: 2 });
  const jpeg = await qrisUtil.pngToJpegBuffer(png);
  assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
  assert.equal(await qrisUtil.decodeQrisPayloadFromBuffer(png), payload);
  assert.equal(await qrisUtil.decodeQrisPayloadFromBuffer(jpeg), payload);
});
