const { pool } = require('../config/db');

/** Write an audit record. `db` may be the pool or a transaction connection. Never throws. */
async function audit(db, { req, user, companyId, action, module: mod, recordId, oldValue, newValue }) {
  try {
    const u = user || (req && req.user) || {};
    await (db || pool).query(
      `INSERT INTO audit_logs (company_id, user_id, action, module, record_id, old_value, new_value, ip_address)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        companyId || u.company_id || null,
        u.id || null,
        action,
        mod,
        recordId != null ? String(recordId) : null,
        oldValue !== undefined ? JSON.stringify(oldValue) : null,
        newValue !== undefined ? JSON.stringify(newValue) : null,
        req ? (req.ip || null) : null,
      ]
    );
  } catch (e) {
    console.error('audit log failed:', e.message);
  }
}

module.exports = { audit };
