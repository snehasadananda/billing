const cron = require('node-cron');
const { pool } = require('../config/db');
const env = require('../config/env');
const recurring = require('../services/recurring');

let running = false;

/** One tick: refresh statuses, create due recurring estimates, send reminders. Safe to run repeatedly. */
async function tick() {
  if (running) return;
  running = true;
  let lockConn;
  try {
    // Cross-process lock so two Node instances never run the job simultaneously (idempotency is the second safety net)
    lockConn = await pool.getConnection();
    const [[l]] = await lockConn.query("SELECT GET_LOCK('billing_scheduler', 0) AS got");
    if (Number(l.got) !== 1) return;
    const res = await recurring.runAll();
    if (res.some((r) => r.created || r.sent || r.failed)) console.log('[scheduler]', JSON.stringify(res));
  } catch (e) {
    console.error('[scheduler] tick failed:', e.message);
  } finally {
    if (lockConn) {
      try { await lockConn.query("SELECT RELEASE_LOCK('billing_scheduler')"); } catch (_) { /* ignore */ }
      lockConn.release();
    }
    running = false;
  }
}

function start() {
  if (!env.enableScheduler) { console.log('[scheduler] disabled (ENABLE_SCHEDULER=false)'); return; }
  cron.schedule('5 * * * *', tick, { timezone: env.timezone }); // hourly: billing, invoice-status, reminder and retry jobs
  setTimeout(tick, 15000); // catch up shortly after boot / restart
  console.log('[scheduler] started (hourly, idempotent)');
}

module.exports = { start, tick };
