const router = require('express').Router();
const { pool } = require('../config/db');
const { asyncHandler, validate, ok, z, idNum, dateStr, optStr } = require('../utils/http');
const { numStr } = require('../utils/schemas');
const { badRequest, notFound } = require('../utils/errors');
const { today, addDays } = require('../utils/dates');
const { audit } = require('../utils/audit');
const { adminOnly } = require('../middleware/auth');
const recurring = require('../services/recurring');
const { runReport } = require('../services/reports');

const cycleSchema = z.object({
  customer_id: idNum,
  billing_frequency: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY', 'CUSTOM']).default('MONTHLY'),
  custom_interval_days: z.coerce.number().int().min(1).max(3650).optional().nullable(),
  billing_day: z.coerce.number().int().min(1).max(31).default(1),
  billing_amount: numStr.refine((v) => Number(v) > 0, 'Billing amount must be greater than zero'),
  gst_rate: numStr.default('18'),
  item_description: z.string().trim().min(1).max(300).default('Monthly service charges'),
  hsn_sac: optStr(20),
  payment_terms_days: z.coerce.number().int().min(0).max(365).default(10),
  auto_create_estimate: z.boolean().default(true),
  auto_convert_invoice: z.boolean().default(true),
  reminder_days: z.string().trim().regex(/^(\d+(,\s*\d+)*)?$/, 'Use comma separated days, e.g. 7,3,1,0').optional().nullable().transform((v) => v || null),
  start_date: dateStr,
  end_date: dateStr.optional().nullable(),
  next_billing_date: dateStr.optional().nullable(),
  status: z.enum(['ACTIVE', 'PAUSED', 'ENDED']).default('ACTIVE'),
  notes: optStr(1000),
});
const F = ['customer_id', 'billing_frequency', 'custom_interval_days', 'billing_day', 'billing_amount', 'gst_rate', 'item_description', 'hsn_sac', 'payment_terms_days', 'auto_create_estimate', 'auto_convert_invoice', 'reminder_days', 'start_date', 'end_date', 'status', 'notes'];

router.get('/cycles', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT bc.*, COALESCE(c.company_name, c.name) customer_name,
       ROUND(bc.billing_amount * (1 + bc.gst_rate/100), 2) total_with_gst,
       (SELECT COUNT(*) FROM billing_jobs j WHERE j.billing_cycle_id=bc.id AND j.status='FAILED') failed_jobs
     FROM billing_cycles bc JOIN customers c ON c.id=bc.customer_id WHERE bc.company_id=? ORDER BY bc.status, bc.next_billing_date`, [req.user.company_id]);
  ok(res, rows);
}));

router.post('/cycles', validate(cycleSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const [[c]] = await pool.query('SELECT id FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL', [b.customer_id, req.user.company_id]);
  if (!c) throw badRequest('CUSTOMER_NOT_FOUND', 'Customer not found');
  if (b.billing_frequency === 'CUSTOM' && !b.custom_interval_days) throw badRequest('INTERVAL_REQUIRED', 'Enter the custom interval in days');
  const next = b.next_billing_date || recurring.firstBillingDate(b.start_date, b.billing_day, b.billing_frequency);
  const vals = F.map((f) => (typeof b[f] === 'boolean' ? (b[f] ? 1 : 0) : (b[f] ?? null)));
  const [r] = await pool.query(`INSERT INTO billing_cycles (company_id, ${F.join(',')}, next_billing_date) VALUES (?, ${F.map(() => '?').join(',')}, ?)`, [req.user.company_id, ...vals, next]);
  await audit(pool, { req, action: 'CREATE', module: 'BILLING_CYCLE', recordId: r.insertId, newValue: { customer_id: b.customer_id, amount: b.billing_amount, next } });
  ok(res, { id: r.insertId, next_billing_date: next });
}));

router.put('/cycles/:id', validate(cycleSchema), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); const b = req.body;
  const [[old]] = await pool.query('SELECT * FROM billing_cycles WHERE id=? AND company_id=?', [id, req.user.company_id]);
  if (!old) throw notFound('Billing cycle');
  let next = b.next_billing_date || old.next_billing_date;
  if (!b.next_billing_date && !old.last_billing_date) next = recurring.firstBillingDate(b.start_date, b.billing_day, b.billing_frequency);
  const vals = F.map((f) => (typeof b[f] === 'boolean' ? (b[f] ? 1 : 0) : (b[f] ?? null)));
  await pool.query(`UPDATE billing_cycles SET ${F.map((f) => `${f}=?`).join(',')}, next_billing_date=? WHERE id=?`, [...vals, next, id]);
  await audit(pool, { req, action: 'UPDATE', module: 'BILLING_CYCLE', recordId: id, oldValue: { amount: old.billing_amount, status: old.status, next: old.next_billing_date }, newValue: { amount: b.billing_amount, status: b.status, next } });
  ok(res, { id, next_billing_date: next });
}));

router.delete('/cycles/:id', adminOnly, asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  const [[old]] = await pool.query('SELECT * FROM billing_cycles WHERE id=? AND company_id=?', [id, req.user.company_id]);
  if (!old) throw notFound('Billing cycle');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM estimates WHERE billing_cycle_id=?', [id]);
  if (n > 0) { await pool.query("UPDATE billing_cycles SET status='ENDED' WHERE id=?", [id]); }
  else { await pool.query('DELETE FROM billing_jobs WHERE billing_cycle_id=?', [id]); await pool.query('DELETE FROM billing_cycles WHERE id=?', [id]); }
  await audit(pool, { req, action: n > 0 ? 'END' : 'DELETE', module: 'BILLING_CYCLE', recordId: id, oldValue: { customer_id: old.customer_id, amount: old.billing_amount } });
  ok(res, { id, ended: n > 0 });
}));

router.get('/upcoming', asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 45, 365); const t = today();
  const [rows] = await pool.query(
    `SELECT bc.id, bc.customer_id, COALESCE(c.company_name, c.name) customer_name, bc.next_billing_date, bc.billing_frequency, bc.billing_amount, bc.gst_rate,
       ROUND(bc.billing_amount * (1 + bc.gst_rate/100), 2) total_with_gst, bc.auto_create_estimate
     FROM billing_cycles bc JOIN customers c ON c.id=bc.customer_id
     WHERE bc.company_id=? AND bc.status='ACTIVE' AND bc.next_billing_date <= ? ORDER BY bc.next_billing_date`, [req.user.company_id, addDays(t, days)]);
  ok(res, rows);
}));

router.get('/overdue', asyncHandler(async (req, res) => {
  const rep = await runReport(req.user.company_id, 'overdue', {});
  ok(res, rep.rows);
}));

router.get('/jobs', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT j.*, COALESCE(c.company_name, c.name) customer_name FROM billing_jobs j JOIN billing_cycles bc ON bc.id=j.billing_cycle_id JOIN customers c ON c.id=bc.customer_id
     WHERE bc.company_id=? AND j.status='FAILED' ORDER BY j.updated_at DESC LIMIT 50`, [req.user.company_id]);
  ok(res, rows);
}));

/** Manually create the estimate for the cycle's current billing date (idempotent for the period). */
router.post('/:id/generate', asyncHandler(async (req, res) => {
  const r = await recurring.generateForCycle(idNum.parse(req.params.id), { companyId: req.user.company_id, user: req.user, req, force: true });
  ok(res, r);
}));

router.post('/run-scheduler', adminOnly, asyncHandler(async (_req, res) => ok(res, await recurring.runAll())));

module.exports = router;
