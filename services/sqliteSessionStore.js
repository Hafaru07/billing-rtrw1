const session = require('express-session');
const { logger } = require('../config/logger');

class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS web_sessions (
      sid TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ); CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);`);
    this.select = db.prepare('SELECT data FROM web_sessions WHERE sid = ? AND expires_at > ?');
    this.upsert = db.prepare('INSERT INTO web_sessions (sid, data, expires_at) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires_at=excluded.expires_at');
    this.delete = db.prepare('DELETE FROM web_sessions WHERE sid = ?');
    this.expire = db.prepare('DELETE FROM web_sessions WHERE expires_at <= ?');
    this.touchStmt = db.prepare('UPDATE web_sessions SET expires_at = ? WHERE sid = ?');
    this.timer = setInterval(() => {
      try { this.expire.run(Date.now()); } catch (error) { logger.error(`[Session] Gagal menghapus sesi kedaluwarsa: ${error.message}`); }
    }, 15 * 60 * 1000);
    this.timer.unref();
  }

  expiresAt(value) {
    const fromCookie = Date.parse(value?.cookie?.expires || '');
    return Number.isFinite(fromCookie) ? fromCookie : Date.now() + 24 * 60 * 60 * 1000;
  }

  get(sid, callback) {
    try {
      const row = this.select.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) { callback(error); }
  }

  set(sid, value, callback = () => {}) {
    try { this.upsert.run(sid, JSON.stringify(value), this.expiresAt(value)); callback(null); }
    catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try { this.delete.run(sid); callback(null); }
    catch (error) { callback(error); }
  }

  touch(sid, value, callback = () => {}) {
    try { this.touchStmt.run(this.expiresAt(value), sid); callback(null); }
    catch (error) { callback(error); }
  }
}

module.exports = SqliteSessionStore;
