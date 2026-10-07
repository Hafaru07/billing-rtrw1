const crypto = require('crypto');

const HASH_BYTES = 64;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;
  else if (digits.startsWith('8')) digits = `62${digits}`;
  return /^62\d{8,13}$/.test(digits) ? digits : '';
}

function validatePassword(value) {
  const password = typeof value === 'string' ? value.trim() : '';
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error(`Password portal harus ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} karakter.`);
  }
  return password;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, HASH_BYTES).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const actual = crypto.scryptSync(String(password), parts[1], HASH_BYTES);
  return crypto.timingSafeEqual(actual, Buffer.from(parts[2], 'hex'));
}

function createCustomerPortalAuth(db) {
  function findPhoneMatches(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return [];
    return db.prepare('SELECT id, phone FROM customers WHERE phone IS NOT NULL AND phone != \'\'')
      .all().filter(row => normalizePhone(row.phone) === normalized);
  }

  function findCustomerByPhone(phone) {
    const matches = findPhoneMatches(phone);
    return matches.length === 1 ? matches[0] : null;
  }

  function assertPhoneAvailable(phone, customerId = null) {
    if (!normalizePhone(phone)) throw new Error('Nomor WhatsApp pelanggan tidak valid.');
    if (findPhoneMatches(phone).some(row => Number(row.id) !== Number(customerId))) {
      throw new Error('Nomor WhatsApp sudah dipakai pelanggan lain. Login portal memerlukan nomor unik.');
    }
  }

  function setPassword(customerId, input) {
    const password = validatePassword(input);
    const hash = hashPassword(password);
    const version = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      INSERT INTO customer_portal_credentials (customer_id, password_hash, auth_version, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(customer_id) DO UPDATE SET
        password_hash = excluded.password_hash,
        auth_version = excluded.auth_version,
        updated_at = CURRENT_TIMESTAMP
    `).run(customerId, hash, version);
  }

  function getAuthVersion(customerId) {
    return db.prepare('SELECT auth_version FROM customer_portal_credentials WHERE customer_id = ?')
      .get(customerId)?.auth_version || null;
  }

  function invalidateSessions(customerId) {
    db.prepare('UPDATE customer_portal_credentials SET auth_version = ? WHERE customer_id = ?')
      .run(crypto.randomBytes(16).toString('hex'), customerId);
  }

  function authenticate(phone, password) {
    const customer = findCustomerByPhone(phone);
    const entered = typeof password === 'string' ? password.trim() : '';
    if (!customer || !entered) return null;
    const row = db.prepare('SELECT password_hash, auth_version FROM customer_portal_credentials WHERE customer_id = ?').get(customer.id);
    return row && verifyPassword(entered, row.password_hash)
      ? { ...customer, authVersion: row.auth_version }
      : null;
  }

  return { findCustomerByPhone, assertPhoneAvailable, setPassword, getAuthVersion, invalidateSessions, authenticate };
}

module.exports = { createCustomerPortalAuth, validatePassword, hashPassword, verifyPassword, normalizePhone };
