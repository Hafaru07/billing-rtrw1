const crypto = require('crypto');
const { getSetting } = require('./settingsManager');

function getAdminUsername() {
  return String(process.env.ADMIN_USERNAME || getSetting('admin_username', 'admin') || '').trim();
}

function getAdminPassword() {
  const password = String(process.env.ADMIN_PASSWORD || getSetting('admin_password', '') || '');
  if (!password || password === 'admin123') return '';
  return password;
}

function verifyAdminCredentials(username, password) {
  const expectedUsername = getAdminUsername();
  const expectedPassword = getAdminPassword();
  if (!expectedUsername || !expectedPassword || String(username || '').toLowerCase() !== expectedUsername.toLowerCase()) return false;
  const supplied = Buffer.from(String(password || ''));
  const expected = Buffer.from(expectedPassword);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = { getAdminUsername, getAdminPassword, verifyAdminCredentials };
