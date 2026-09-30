const mysql = require('mysql2/promise');
const env = require('./env');

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true, // DATE/DATETIME come back as strings (no timezone surprises)
  decimalNumbers: false, // DECIMAL comes back as string (never a lossy float)
  charset: 'utf8mb4',
});

// Store all timestamps in UTC
pool.pool.on('connection', (conn) => {
  conn.query("SET time_zone = '+00:00'");
});

/**
 * Run fn(conn) inside a transaction. Rolls back on any error and transparently retries
 * (up to 3 times) when MySQL aborts the transaction as a deadlock victim.
 */
async function withTransaction(fn) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      lastErr = err;
      if (!(err && (err.errno === 1213 || err.code === 'ER_LOCK_DEADLOCK')) || attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 30 * attempt));
    } finally {
      conn.release();
    }
  }
  throw lastErr;
}

module.exports = { pool, withTransaction };
