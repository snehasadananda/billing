const { pool } = require('../config/db');
const defaults = require('../db/defaults');

/** Load company settings merged with defaults, with typed accessors. */
async function getSettings(db, companyId) {
  const [rows] = await (db || pool).query('SELECT setting_key, setting_value FROM settings WHERE company_id=?', [companyId]);
  const raw = { ...defaults };
  rows.forEach((r) => { raw[r.setting_key] = r.setting_value; });
  const bool = (k) => String(raw[k]).toLowerCase() === 'true';
  const num = (k) => Number(raw[k]);
  const list = (k) => String(raw[k] || '').split(',').map((s) => s.trim()).filter((s) => s !== '').map(Number).filter((n) => !Number.isNaN(n));
  return { raw, bool, num, list };
}

async function setSettings(db, companyId, obj) {
  for (const [k, v] of Object.entries(obj)) {
    if (!(k in defaults)) continue; // only known keys
    await (db || pool).query(
      `INSERT INTO settings (company_id, setting_key, setting_value) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [companyId, k, String(v)]
    );
  }
}

module.exports = { getSettings, setSettings, defaults };
