const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createCustomerPortalAuth, validatePassword, normalizePhone } = require('../services/customerPortalAuth');

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE customers (id INTEGER PRIMARY KEY, phone TEXT, pppoe_password TEXT);
    CREATE TABLE customer_portal_credentials (
      customer_id INTEGER PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
      password_hash TEXT NOT NULL,
      auth_version TEXT NOT NULL,
      updated_at DATETIME
    );
  `);
  return db;
}

test('portal password is hashed and independent of PPPoE credentials', () => {
  const db = makeDb();
  try {
    db.prepare('INSERT INTO customers (id, phone, pppoe_password) VALUES (1, ?, ?)').run('085875003174', 'network-secret');
    const auth = createCustomerPortalAuth(db);

    assert.equal(auth.authenticate('085875003174', 'network-secret'), null);
    auth.setPassword(1, 'portal-secret-123');
    const firstLogin = auth.authenticate('+6285875003174', 'portal-secret-123');
    assert.equal(firstLogin.id, 1);
    assert.equal(auth.getAuthVersion(1), firstLogin.authVersion);
    assert.equal(auth.authenticate('085875003174', 'network-secret'), null);
    assert.equal(db.prepare('SELECT pppoe_password FROM customers WHERE id = 1').get().pppoe_password, 'network-secret');
    assert.notEqual(db.prepare('SELECT password_hash FROM customer_portal_credentials WHERE customer_id = 1').get().password_hash, 'portal-secret-123');

    auth.setPassword(1, 'new-portal-secret');
    assert.equal(auth.authenticate('085875003174', 'portal-secret-123'), null);
    assert.equal(auth.authenticate('085875003174', 'new-portal-secret').id, 1);
    assert.notEqual(auth.getAuthVersion(1), firstLogin.authVersion);

    const beforeInvalidate = auth.getAuthVersion(1);
    auth.invalidateSessions(1);
    assert.notEqual(auth.getAuthVersion(1), beforeInvalidate);
    assert.equal(auth.authenticate('085875003174', 'new-portal-secret').id, 1);

    db.prepare('DELETE FROM customers WHERE id = 1').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customer_portal_credentials').get().count, 0);
  } finally {
    db.close();
  }
});

test('phone matching is exact after normalization and rejects duplicates', () => {
  const db = makeDb();
  try {
    const auth = createCustomerPortalAuth(db);
    db.prepare('INSERT INTO customers (id, phone) VALUES (1, ?)').run('081234567890');
    auth.setPassword(1, 'customer-pass');
    assert.equal(auth.authenticate('6281234567890', 'customer-pass').id, 1);
    assert.equal(auth.authenticate('34567890', 'customer-pass'), null);
    db.prepare('INSERT INTO customers (id, phone) VALUES (2, ?)').run('+6281234567890');
    assert.equal(auth.authenticate('081234567890', 'customer-pass'), null);
    assert.throws(() => auth.assertPhoneAvailable('081234567890', 1), /nomor unik/i);
  } finally {
    db.close();
  }
});

test('password policy and phone normalization', () => {
  assert.throws(() => validatePassword('short'), /8-128/);
  assert.throws(() => validatePassword('x'.repeat(129)), /8-128/);
  assert.equal(normalizePhone('+62 812-3456-7890'), '6281234567890');
});
