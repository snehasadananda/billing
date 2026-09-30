const { pool } = require('../config/db');

/**
 * Create an in-app notification. If dedupeKey is given the same notification is never created twice
 * (unique index) - this is what makes the scheduler safe to re-run.
 * Returns true when a new row was created.
 */
async function notify(db, { companyId, userId = null, type, title, message, refType = null, refId = null, dedupeKey = null }) {
  const [r] = await (db || pool).query(
    `INSERT IGNORE INTO notifications (company_id, user_id, type, title, message, reference_type, reference_id, dedupe_key, sent_at)
     VALUES (?,?,?,?,?,?,?,?, UTC_TIMESTAMP())`,
    [companyId, userId, type, title, String(message).slice(0, 500), refType, refId, dedupeKey]
  );
  return r.affectedRows > 0;
}

module.exports = { notify };
