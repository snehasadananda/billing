const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const env = require('../config/env');

(async () => {
  const conn = await mysql.createConnection({
    host: env.db.host, port: env.db.port, user: env.db.user, password: env.db.password,
    database: env.db.database, multipleStatements: true,
  });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await conn.query(sql);
  console.log('Schema is up to date.');
  await conn.end();
})().catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
