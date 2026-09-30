const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const env = require('../config/env');
const defaults = require('./defaults');

(async () => {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) c FROM companies');
  let companyId;
  if (c === 0) {
    const [r] = await pool.query(
      `INSERT INTO companies (name, state, country, default_gst_rate, payment_terms_days, terms_and_conditions)
       VALUES (?,?,?,?,?,?)`,
      ['My Company', 'Karnataka', 'India', 18, 15, '1. Payment is due as per the agreed payment terms.\n2. Goods/services once sold are not returnable.\n3. Subject to local jurisdiction.']
    );
    companyId = r.insertId;
    console.log('Created company id', companyId);
  } else {
    [[{ id: companyId }]] = await pool.query('SELECT id FROM companies ORDER BY id LIMIT 1');
  }

  for (const rate of [0, 5, 12, 18, 28]) {
    await pool.query('INSERT IGNORE INTO gst_rates (company_id, rate, label) VALUES (?,?,?)', [companyId, rate, `${rate}%`]);
  }
  for (const [k, v] of Object.entries(defaults)) {
    await pool.query('INSERT IGNORE INTO settings (company_id, setting_key, setting_value) VALUES (?,?,?)', [companyId, k, v]);
  }

  const [[{ u }]] = await pool.query('SELECT COUNT(*) u FROM users');
  if (u === 0) {
    const hash = await bcrypt.hash(env.admin.password, 12);
    await pool.query(
      'INSERT INTO users (company_id, name, email, password_hash, role) VALUES (?,?,?,?,?)',
      [companyId, env.admin.name, env.admin.email.toLowerCase(), hash, 'ADMIN']
    );
    console.log(`Created admin user ${env.admin.email} (change the password after first login).`);
  } else {
    console.log('Users already exist; admin not created.');
  }
  await pool.end();
  console.log('Seed complete.');
})().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
