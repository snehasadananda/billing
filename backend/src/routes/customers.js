const router = require('express').Router();
const { pool } = require('../config/db');
const { asyncHandler, validate, ok, z, optStr, idNum, pageParams, orderBy, dateStr } = require('../utils/http');
const { notFound, conflict } = require('../utils/errors');
const { audit } = require('../utils/audit');
const { today } = require('../utils/dates');
const { money } = require('../utils/money');
const { docsUnion, PAY_GST_SQL, PAY_JOIN } = require('../services/reports');

const rate = z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))).refine((v) => v === null || (v >= 0 && v <= 100), 'GST rate must be 0-100');
const schema = z.object({
  name: z.string().trim().min(1, 'Customer name is required').max(200),
  company_name: optStr(200), contact_person: optStr(150), mobile: optStr(30),
  email: z.string().trim().email('Enter a valid email').max(190).optional().nullable().or(z.literal('')).transform((v) => v || null),
  billing_address: optStr(500), shipping_address: optStr(500), city: optStr(100), state: optStr(100), country: optStr(100), pin_code: optStr(20),
  gstin: z.string().trim().toUpperCase().max(20).regex(/^([0-9A-Z]{15})?$/, 'GSTIN must be 15 characters').optional().nullable().transform((v) => v || null),
  pan: optStr(20), customer_type: z.enum(['INDIVIDUAL', 'BUSINESS', 'COMPANY', 'OTHER']).default('BUSINESS'),
  payment_terms_days: z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === '' || v === undefined || v === null ? null : Number(v))),
  default_gst_rate: rate, notes: optStr(2000), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
const FIELDS = ['name', 'company_name', 'contact_person', 'mobile', 'email', 'billing_address', 'shipping_address', 'city', 'state', 'country', 'pin_code', 'gstin', 'pan', 'customer_type', 'payment_terms_days', 'default_gst_rate', 'notes', 'status'];

const OUTSTANDING_SQL = `(SELECT COALESCE(SUM(balance_due),0) FROM invoices WHERE customer_id=c.id AND status NOT IN ('DRAFT','CANCELLED','VOID'))
 + (SELECT COALESCE(SUM(balance_due),0) FROM estimates WHERE customer_id=c.id AND status IN ('AUTO_GENERATED','ACCEPTED','PAYMENT_PENDING','PAID'))`;

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const where = ['c.company_id=?', 'c.deleted_at IS NULL']; const args = [req.user.company_id];
  if (req.query.q) { where.push('(c.name LIKE ? OR c.company_name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ? OR c.gstin LIKE ?)'); const l = `%${req.query.q}%`; args.push(l, l, l, l, l); }
  if (req.query.status) { where.push('c.status=?'); args.push(req.query.status); }
  if (req.query.customer_type) { where.push('c.customer_type=?'); args.push(req.query.customer_type); }
  const ord = orderBy(req, { name: 'c.name', created_at: 'c.created_at', outstanding: 'outstanding' }, 'c.name');
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM customers c WHERE ${where.join(' AND ')}`, args);
  const [rows] = await pool.query(`SELECT c.*, (${OUTSTANDING_SQL}) AS outstanding FROM customers c WHERE ${where.join(' AND ')} ORDER BY ${ord === 'c.name DESC' && !req.query.sort ? 'c.name ASC' : ord} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); const cid = req.user.company_id; const t = today();
  const [[c]] = await pool.query('SELECT * FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL', [id, cid]);
  if (!c) throw notFound('Customer');
  const { sql, params } = docsUnion(cid);
  const [[s]] = await pool.query(
    `SELECT COALESCE(SUM(grand_total),0) billing, COALESCE(SUM(CASE WHEN balance_due>0 THEN balance_due END),0) pending,
            COALESCE(SUM(CASE WHEN balance_due>0 AND due_date < ? THEN balance_due END),0) overdue
     FROM (${sql}) d WHERE customer_id=?`, [t, ...params, id]);
  const [[p]] = await pool.query(`SELECT COALESCE(SUM(p.amount),0) paid, COALESCE(SUM(${PAY_GST_SQL}),0) gst ${PAY_JOIN} WHERE p.customer_id=? AND p.status='VALID'`, [id]);
  const [[e]] = await pool.query("SELECT COUNT(*) c, COALESCE(SUM(grand_total),0) v FROM estimates WHERE customer_id=? AND status NOT IN ('CANCELLED','REJECTED')", [id]);
  const [[i]] = await pool.query("SELECT COALESCE(SUM(grand_total),0) v FROM invoices WHERE customer_id=? AND status NOT IN ('DRAFT','CANCELLED','VOID')", [id]);
  ok(res, {
    ...c,
    summary: {
      total_estimates: e.c, total_estimates_value: money(e.v), total_invoice_value: money(i.v), total_billing: money(s.billing),
      total_paid: money(p.paid), total_pending: money(s.pending), total_overdue: money(s.overdue), total_gst_collected: money(p.gst),
    },
  });
}));

router.get('/:id/transactions', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); const cid = req.user.company_id;
  const [[c]] = await pool.query('SELECT id FROM customers WHERE id=? AND company_id=?', [id, cid]);
  if (!c) throw notFound('Customer');
  const [estimates] = await pool.query('SELECT id, estimate_number, estimate_date, grand_total, amount_paid, balance_due, status FROM estimates WHERE customer_id=? ORDER BY estimate_date DESC, id DESC LIMIT 100', [id]);
  const [invoices] = await pool.query('SELECT id, invoice_number, invoice_date, due_date, grand_total, amount_paid, balance_due, status FROM invoices WHERE customer_id=? ORDER BY invoice_date DESC, id DESC LIMIT 100', [id]);
  const [payments] = await pool.query(`SELECT p.id, p.receipt_number, p.payment_date, p.amount, p.payment_method, p.transaction_id, p.status, COALESCE(i.invoice_number, e.estimate_number) document
    ${PAY_JOIN} WHERE p.customer_id=? ORDER BY p.payment_date DESC, p.id DESC LIMIT 100`, [id]);
  ok(res, { estimates, invoices, payments });
}));

router.get('/:id/outstanding', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); const cid = req.user.company_id; const t = today();
  const { sql, params } = docsUnion(cid);
  const [rows] = await pool.query(
    `SELECT doc_type, id, doc_no, doc_date, due_date, grand_total, amount_paid, balance_due, CASE WHEN due_date < ? THEN DATEDIFF(?, due_date) ELSE 0 END days_overdue
     FROM (${sql}) d WHERE customer_id=? AND balance_due > 0 ORDER BY due_date`, [t, t, ...params, id]);
  ok(res, rows);
}));

router.post('/', validate(schema), asyncHandler(async (req, res) => {
  const b = req.body;
  const [r] = await pool.query(`INSERT INTO customers (company_id, ${FIELDS.join(',')}) VALUES (?, ${FIELDS.map(() => '?').join(',')})`, [req.user.company_id, ...FIELDS.map((f) => b[f] ?? null)]);
  await audit(pool, { req, action: 'CREATE', module: 'CUSTOMER', recordId: r.insertId, newValue: { name: b.name } });
  ok(res, { id: r.insertId });
}));

router.put('/:id', validate(schema), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); const b = req.body;
  const [[old]] = await pool.query('SELECT * FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL', [id, req.user.company_id]);
  if (!old) throw notFound('Customer');
  await pool.query(`UPDATE customers SET ${FIELDS.map((f) => `${f}=?`).join(',')} WHERE id=?`, [...FIELDS.map((f) => b[f] ?? null), id]);
  await audit(pool, { req, action: 'UPDATE', module: 'CUSTOMER', recordId: id, oldValue: { name: old.name, gstin: old.gstin, state: old.state, status: old.status }, newValue: { name: b.name, gstin: b.gstin, state: b.state, status: b.status } });
  ok(res, { id });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); const cid = req.user.company_id;
  const [[c]] = await pool.query('SELECT id, name FROM customers WHERE id=? AND company_id=? AND deleted_at IS NULL', [id, cid]);
  if (!c) throw notFound('Customer');
  const [[o]] = await pool.query(`SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id=? AND balance_due>0 AND status NOT IN ('CANCELLED','VOID')) + (SELECT COUNT(*) FROM estimates WHERE customer_id=? AND balance_due>0 AND status IN ('AUTO_GENERATED','ACCEPTED','PAYMENT_PENDING')) open_docs`, [id, id]);
  if (Number(o.open_docs) > 0) throw conflict('HAS_OUTSTANDING', 'This customer has unpaid documents and cannot be deleted. Mark the customer inactive instead.');
  await pool.query("UPDATE customers SET deleted_at=UTC_TIMESTAMP(), status='INACTIVE' WHERE id=?", [id]); // soft delete keeps history intact
  await pool.query("UPDATE billing_cycles SET status='ENDED' WHERE customer_id=? AND status<>'ENDED'", [id]);
  await audit(pool, { req, action: 'DELETE', module: 'CUSTOMER', recordId: id, oldValue: { name: c.name } });
  ok(res, { id });
}));

void dateStr;
module.exports = router;
