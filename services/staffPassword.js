const crypto = require('crypto');

const PREFIX = 'scrypt$';

function hashPassword(password) {
  const value = String(password || '');
  if (!value) throw new Error('Password wajib diisi');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(value, salt, 64);
  return `${PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const value = String(password || '');
  const saved = String(stored || '');
  if (!value || !saved) return false;
  if (saved.startsWith(PREFIX)) {
    const [, saltHex, hashHex] = saved.split('$');
    if (!/^[a-f0-9]{32}$/.test(saltHex || '') || !/^[a-f0-9]{128}$/.test(hashHex || '')) return false;
    const hash = crypto.scryptSync(value, Buffer.from(saltHex, 'hex'), 64);
    return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
  }
  const supplied = Buffer.from(value);
  const expected = Buffer.from(saved);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function migrateStaffPasswords(db) {
  const tables = ['technicians', 'cashiers', 'collectors', 'agents'];
  const migrate = db.transaction(() => {
    for (const table of tables) {
      const rows = db.prepare(`SELECT id, password FROM ${table}`).all();
      const update = db.prepare(`UPDATE ${table} SET password=? WHERE id=?`);
      for (const row of rows) {
        if (row.password && !String(row.password).startsWith(PREFIX)) update.run(hashPassword(row.password), row.id);
      }
    }
  });
  migrate();
}

module.exports = { hashPassword, verifyPassword, migrateStaffPasswords };
