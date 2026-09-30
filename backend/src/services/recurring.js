/**
 * Recurring billing automation (Rule C). Everything here is IDEMPOTENT:
 *  - estimates carry a UNIQUE (billing_cycle_id, billing_period) key, so a re-run / restart / retry can never duplicate a bill
 *  - notifications carry a UNIQUE dedupe_key, so reminders are sent once
 */
const { pool, withTransaction } = require('../config/db');
const { D } = require('../utils/money');
const { today, addMonths, addDays, diffDays, periodOf, parse, fmt, daysInMonth } = require('../utils/dates');
const { getSettings } = require('./settings');
const { notify } = require('./notifications');
const { audit } = require('../utils/audit');
const ledger = require('./ledger');

const MAX_ATTEMPTS = 10;
const FREQ_MONTHS = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };

/** First billing date on/after start date (billing day of month for calendar frequencies). */
function firstBillingDate(startDate, billingDay, frequency) {
  if (frequency === 'CUSTOM') return startDate;
  const { y, m } = parse(startDate);
  const cand = fmt(y, m, Math.min(billingDay, daysInMonth(y, m)));
  return cand >= startDate ? cand : addMonths(cand, 1, billingDay);
}

function advance(cycle, fromDate) {
  if (cycle.billing_frequency === 'CUSTOM') return addDays(fromDate, Number(cycle.custom_interval_days) || 30);
  return addMonths(fromDate, FREQ_MONTHS[cycle.billing_frequency] || 1, cycle.billing_day);
}

/** Create (once) the estimate for the cycle's current billing date, then move the cycle forward. */
async function generateForCycle(cycleId, { companyId, user = null, req = null, force = false } = {}) {
  return withTransaction(async (conn) => {
    const [[cycle]] = await conn.query('SELECT * FROM billing_cycles WHERE id=? AND company_id=? FOR UPDATE', [cycleId, companyId]);
    if (!cycle) throw new Error('Billing cycle not found');
    if (cycle.status !== 'ACTIVE' && !force) return { skipped: 'NOT_ACTIVE' };
    const billingDate = cycle.next_billing_date;
    const period = periodOf(billingDate);

    const [[existing]] = await conn.query('SELECT id, estimate_number FROM estimates WHERE billing_cycle_id=? AND billing_period=?', [cycle.id, period]);
    let created = false; let est = existing;
    if (!existing) {
      const [[customer]] = await conn.query('SELECT id, name, company_name FROM customers WHERE id=?', [cycle.customer_id]);
      est = await ledger.createEstimate(conn, {
        companyId, user, req, status: 'AUTO_GENERATED', cycle, billingPeriod: period,
        payload: {
          customer_id: cycle.customer_id, estimate_date: billingDate, payment_terms_days: cycle.payment_terms_days,
          items: [{ description: cycle.item_description, hsn_sac: cycle.hsn_sac, quantity: 1, unit: 'Nos', rate: cycle.billing_amount, discount: 0, gst_rate: cycle.gst_rate }],
          notes: `Auto-generated for billing period ${period}`,
        },
      });
      created = true;
      const [[e2]] = await conn.query('SELECT grand_total FROM estimates WHERE id=?', [est.id]);
      await notify(conn, {
        companyId, type: 'ESTIMATE_CREATED', title: 'Monthly estimate created',
        message: `Estimate ${est.number} was created automatically for ${customer.company_name || customer.name}. Amount: Rs. ${e2.grand_total}`,
        refType: 'ESTIMATE', refId: est.id, dedupeKey: `est-auto:${cycle.id}:${period}`,
      });
    }

    let next = advance(cycle, billingDate);
    let status = cycle.status;
    if (cycle.end_date && next > cycle.end_date) status = 'ENDED';
    await conn.query('UPDATE billing_cycles SET last_billing_date=?, next_billing_date=?, status=? WHERE id=?', [billingDate, next, status, cycle.id]);
    await conn.query(
      `INSERT INTO billing_jobs (billing_cycle_id, billing_period, status, attempts) VALUES (?,?, 'SUCCESS', 1)
       ON DUPLICATE KEY UPDATE status='SUCCESS', last_error=NULL`, [cycle.id, period]);
    return { created, estimate_id: est.id, estimate_number: est.number || est.estimate_number, period };
  });
}

async function recordFailure(cycle, period, err, companyId) {
  await pool.query(
    `INSERT INTO billing_jobs (billing_cycle_id, billing_period, status, attempts, last_error) VALUES (?,?, 'FAILED', 1, ?)
     ON DUPLICATE KEY UPDATE status='FAILED', attempts = attempts + 1, last_error = VALUES(last_error)`,
    [cycle.id, period, String(err.message || err).slice(0, 480)]
  );
  const [[job]] = await pool.query('SELECT id, attempts, admin_notified FROM billing_jobs WHERE billing_cycle_id=? AND billing_period=?', [cycle.id, period]);
  console.error(`[billing] cycle ${cycle.id} period ${period} failed (attempt ${job.attempts}):`, err.message);
  if (job.attempts >= 3 && !job.admin_notified) {
    await notify(pool, {
      companyId, type: 'BILLING_FAILED', title: 'Automatic billing failed',
      message: `Automatic billing for customer #${cycle.customer_id} (period ${period}) could not be generated after ${job.attempts} attempts. Reason: ${String(err.message).slice(0, 200)}`,
      refType: 'BILLING_CYCLE', refId: cycle.id, dedupeKey: `bill-fail:${cycle.id}:${period}`,
    });
    await pool.query('UPDATE billing_jobs SET admin_notified=1 WHERE id=?', [job.id]);
  }
}

async function processDueCycles(companyId, todayStr = today()) {
  const settings = await getSettings(pool, companyId);
  if (!settings.bool('auto_create_recurring_estimate')) return { created: 0, failed: 0 };
  const [cycles] = await pool.query(
    "SELECT id FROM billing_cycles WHERE company_id=? AND status='ACTIVE' AND auto_create_estimate=1 AND next_billing_date <= ?", [companyId, todayStr]);
  let created = 0; let failed = 0;
  for (const c of cycles) {
    for (let guard = 0; guard < 12; guard += 1) { // catch up missed periods (server was down), bounded
      const [[cur]] = await pool.query('SELECT * FROM billing_cycles WHERE id=?', [c.id]);
      if (!cur || cur.status !== 'ACTIVE' || cur.next_billing_date > todayStr) break;
      const period = periodOf(cur.next_billing_date);
      const [[job]] = await pool.query('SELECT attempts FROM billing_jobs WHERE billing_cycle_id=? AND billing_period=? AND status=\'FAILED\'', [cur.id, period]);
      if (job && job.attempts >= MAX_ATTEMPTS) { failed += 1; break; }
      try {
        const r = await generateForCycle(cur.id, { companyId });
        if (r.created) created += 1;
        if (r.skipped) break;
      } catch (err) {
        failed += 1;
        await recordFailure(cur, period, err, companyId);
        break; // retried automatically on the next scheduler run
      }
    }
  }
  return { created, failed };
}

async function sendReminders(companyId, todayStr = today()) {
  const settings = await getSettings(pool, companyId);
  let sent = 0;
  const tell = async (n) => { if (await notify(pool, { companyId, ...n })) sent += 1; };

  // 1) upcoming billing (before / on billing date)
  const [cycles] = await pool.query(
    `SELECT bc.*, COALESCE(c.company_name, c.name) AS customer_name FROM billing_cycles bc JOIN customers c ON c.id = bc.customer_id
     WHERE bc.company_id=? AND bc.status='ACTIVE'`, [companyId]);
  for (const bc of cycles) {
    const days = bc.reminder_days ? bc.reminder_days.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : settings.list('billing_reminder_days');
    const until = diffDays(todayStr, bc.next_billing_date);
    if (days.includes(until)) {
      const when = until === 0 ? 'is due today' : until === 1 ? 'is due tomorrow' : `is due in ${until} days`;
      await tell({
        type: 'UPCOMING_BILLING', title: 'Upcoming billing',
        message: `Billing for ${bc.customer_name} ${when} (${bc.next_billing_date}). Amount: Rs. ${bc.billing_amount} + GST.`,
        refType: 'BILLING_CYCLE', refId: bc.id, dedupeKey: `bill-rem:${bc.id}:${bc.next_billing_date}:${until}`,
      });
    }
  }

  // 2) collection reminders on recurring estimates still unpaid
  const afterDays = settings.list('collection_reminder_days_after');
  const [ests] = await pool.query(
    `SELECT id, estimate_number, customer_name, estimate_date, due_date, balance_due FROM estimates
     WHERE company_id=? AND billing_cycle_id IS NOT NULL AND balance_due > 0 AND status IN ('AUTO_GENERATED','SENT','VIEWED','ACCEPTED','PAYMENT_PENDING')`, [companyId]);
  for (const e of ests) {
    const since = diffDays(e.estimate_date, todayStr);
    if (afterDays.includes(since) && since > 0) {
      await tell({ type: 'PAYMENT_PENDING', title: 'Payment pending', message: `Payment has not yet been received from ${e.customer_name} (${e.estimate_number}). Outstanding: Rs. ${e.balance_due}`, refType: 'ESTIMATE', refId: e.id, dedupeKey: `coll:${e.id}:${since}` });
    }
    if (settings.bool('billing_reminder_on_due_date') && e.due_date === todayStr) {
      await tell({ type: 'DUE_TODAY', title: 'Payment due today', message: `Payment from ${e.customer_name} (${e.estimate_number}) is due today. Outstanding: Rs. ${e.balance_due}`, refType: 'ESTIMATE', refId: e.id, dedupeKey: `due:est:${e.id}` });
    }
  }

  // 3) overdue reminders (estimates + invoices)
  if (settings.bool('post_due_reminders')) {
    const od = settings.list('overdue_reminder_days_after');
    const [docs] = await pool.query(
      `SELECT 'INVOICE' AS t, id, invoice_number AS no, customer_name, due_date, balance_due FROM invoices
         WHERE company_id=? AND balance_due > 0 AND status IN ('ISSUED','PARTIALLY_PAID','OVERDUE') AND due_date < ?
       UNION ALL
       SELECT 'ESTIMATE', id, estimate_number, customer_name, due_date, balance_due FROM estimates
         WHERE company_id=? AND balance_due > 0 AND status IN ('AUTO_GENERATED','ACCEPTED','PAYMENT_PENDING') AND due_date < ?`,
      [companyId, todayStr, companyId, todayStr]);
    for (const d of docs) {
      const late = diffDays(d.due_date, todayStr);
      if (od.includes(late)) {
        await tell({
          type: 'OVERDUE', title: 'Payment overdue',
          message: `${d.t === 'INVOICE' ? 'Invoice' : 'Estimate'} ${d.no} for ${d.customer_name} is overdue by ${late} day(s). Outstanding: Rs. ${d.balance_due}`,
          refType: d.t, refId: d.id, dedupeKey: `overdue:${d.t}:${d.id}:${late}`,
        });
      }
    }
  }
  return { sent };
}

async function runAll() {
  const [companies] = await pool.query('SELECT id FROM companies');
  const out = [];
  for (const c of companies) {
    await ledger.refreshStatuses(pool, c.id);
    const gen = await processDueCycles(c.id);
    const rem = await sendReminders(c.id);
    out.push({ companyId: c.id, ...gen, ...rem });
  }
  return out;
}

module.exports = { firstBillingDate, advance, generateForCycle, processDueCycles, sendReminders, runAll };
