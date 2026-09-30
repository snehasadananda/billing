const router = require('express').Router();
const fs = require('fs');
const { pool } = require('../config/db');
const env = require('../config/env');
const { asyncHandler, validate, ok, z, optStr, pageParams } = require('../utils/http');
const { numStr } = require('../utils/schemas');
const { adminOnly } = require('../middleware/auth');
const { badRequest } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { getSettings, setSettings, defaults } = require('../services/settings');
const { configured } = require('../services/mailer');

const companySchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(200),
  logo: z.string().max(700000).regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Logo must be a PNG, JPG or WEBP image').optional().nullable().transform((v) => v || null),
  address: optStr(500), city: optStr(100), state: optStr(100), country: optStr(100), pin_code: optStr(20), mobile: optStr(30), email: optStr(150), website: optStr(200),
  gstin: z.string().trim().toUpperCase().regex(/^([0-9A-Z]{15})?$/, 'GSTIN must be 15 characters').optional().nullable().transform((v) => v || null),
  pan: optStr(20), cin: optStr(30), bank_name: optStr(150), account_number: optStr(50), ifsc: optStr(20), branch: optStr(150), upi_id: optStr(100), invoice_prefix: optStr(20),
  default_gst_rate: numStr.refine((v) => Number(v) >= 0 && Number(v) <= 100, 'GST rate must be 0-100'),
  payment_terms_days: z.coerce.number().int().min(0).max(365),
  terms_and_conditions: optStr(5000),
});
const CF = ['name', 'logo', 'address', 'city', 'state', 'country', 'pin_code', 'mobile', 'email', 'website', 'gstin', 'pan', 'cin', 'bank_name', 'account_number', 'ifsc', 'branch', 'upi_id', 'invoice_prefix', 'default_gst_rate', 'payment_terms_days', 'terms_and_conditions'];

router.get('/company', asyncHandler(async (req, res) => {
  const [[c]] = await pool.query('SELECT * FROM companies WHERE id=?', [req.user.company_id]);
  ok(res, c);
}));

router.put('/company', adminOnly, validate(companySchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const [[old]] = await pool.query('SELECT name, gstin, state, default_gst_rate FROM companies WHERE id=?', [req.user.company_id]);
  await pool.query(`UPDATE companies SET ${CF.map((f) => `${f}=?`).join(',')} WHERE id=?`, [...CF.map((f) => b[f] ?? null), req.user.company_id]);
  await audit(pool, { req, action: 'UPDATE', module: 'COMPANY', recordId: req.user.company_id, oldValue: old, newValue: { name: b.name, gstin: b.gstin, state: b.state, default_gst_rate: b.default_gst_rate } });
  ok(res, { updated: true });
}));

const BOOL_KEYS = ['invoice_requires_full_payment', 'auto_create_recurring_estimate', 'auto_convert_to_invoice', 'billing_reminder_on_due_date', 'post_due_reminders', 'allow_advance_payments', 'email_notifications'];
const LIST_KEYS = ['billing_reminder_days', 'collection_reminder_days_after', 'overdue_reminder_days_after'];

router.get('/business', asyncHandler(async (req, res) => {
  const s = await getSettings(pool, req.user.company_id);
  ok(res, { settings: s.raw, email_configured: configured() });
}));

router.put('/business', adminOnly, asyncHandler(async (req, res) => {
  const input = req.body && req.body.settings;
  if (!input || typeof input !== 'object') throw badRequest('VALIDATION_ERROR', 'settings object is required');
  const clean = {};
  for (const [k, vRaw] of Object.entries(input)) {
    if (!(k in defaults)) continue;
    const v = String(vRaw).trim();
    if (BOOL_KEYS.includes(k)) { if (!['true', 'false'].includes(v)) throw badRequest('VALIDATION_ERROR', `${k} must be true or false`); }
    else if (k === 'gst_calculation_basis') { if (!['collections', 'invoices'].includes(v)) throw badRequest('VALIDATION_ERROR', 'GST basis must be collections or invoices'); }
    else if (k === 'invoice_conversion_payment_threshold') { if (!(Number(v) > 0 && Number(v) <= 100)) throw badRequest('VALIDATION_ERROR', 'Payment threshold must be between 1 and 100'); }
    else if (k === 'estimate_validity_days') { if (!(Number(v) >= 0 && Number(v) <= 365)) throw badRequest('VALIDATION_ERROR', 'Estimate validity must be 0-365 days'); }
    else if (LIST_KEYS.includes(k)) { if (!/^(\d+(\s*,\s*\d+)*)?$/.test(v)) throw badRequest('VALIDATION_ERROR', `${k}: use comma separated whole numbers, e.g. 7,3,1,0`); }
    else if (v.length > 60) throw badRequest('VALIDATION_ERROR', `${k} is too long`);
    clean[k] = v;
  }
  const before = (await getSettings(pool, req.user.company_id)).raw;
  await setSettings(pool, req.user.company_id, clean);
  await audit(pool, { req, action: 'UPDATE', module: 'SETTINGS', recordId: req.user.company_id, oldValue: Object.fromEntries(Object.keys(clean).map((k) => [k, before[k]])), newValue: clean });
  ok(res, { updated: Object.keys(clean) });
}));

router.get('/backup-status', adminOnly, asyncHandler(async (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(env.backupDir).filter((f) => /\.(sql|gz|zip|dump)(\.gz)?$/i.test(f)).map((f) => { const st = fs.statSync(`${env.backupDir}/${f}`); return { file: f, size: st.size, modified: st.mtime.toISOString() }; })
      .sort((a, b) => (a.modified < b.modified ? 1 : -1));
  } catch (_) { /* directory may not exist yet */ }
  const last = files[0] || null;
  const ageHours = last ? (Date.now() - new Date(last.modified).getTime()) / 3600000 : null;
  ok(res, { backup_dir: env.backupDir, last_backup: last, healthy: !!last && ageHours < 36, age_hours: ageHours != null ? Math.round(ageHours * 10) / 10 : null, recent: files.slice(0, 10) });
}));

router.get('/audit-logs', adminOnly, asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req, 50); const q = req.query;
  const where = ['(a.company_id=? OR a.company_id IS NULL)']; const args = [req.user.company_id];
  if (q.module) { where.push('a.module=?'); args.push(q.module); }
  if (q.record_id) { where.push('a.record_id=?'); args.push(q.record_id); }
  if (q.user_id) { where.push('a.user_id=?'); args.push(Number(q.user_id)); }
  if (q.action) { where.push('a.action=?'); args.push(q.action); }
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM audit_logs a WHERE ${where.join(' AND ')}`, args);
  const [rows] = await pool.query(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

module.exports = router;
