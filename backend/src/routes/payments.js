const router = require('express').Router();
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, validate, ok, z, idNum, pageParams, orderBy, optStr } = require('../utils/http');
const { paymentSchema } = require('../utils/schemas');
const ledger = require('../services/ledger');
const { receiptPdf } = require('../services/pdf');
const { adminOnly } = require('../middleware/auth');
const { notFound, forbidden } = require('../utils/errors');

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req); const q = req.query;
  const where = ['p.company_id=?']; const args = [req.user.company_id];
  if (q.q) { const l = `%${q.q}%`; where.push('(c.name LIKE ? OR p.transaction_id LIKE ? OR p.reference_number LIKE ? OR p.receipt_number LIKE ? OR i.invoice_number LIKE ? OR e.estimate_number LIKE ?)'); args.push(l, l, l, l, l, l); }
  if (q.customer_id) { where.push('p.customer_id=?'); args.push(Number(q.customer_id)); }
  if (q.method) { where.push('p.payment_method=?'); args.push(q.method); }
  if (q.status) { where.push('p.status=?'); args.push(q.status); }
  if (q.from) { where.push('p.payment_date >= ?'); args.push(q.from); }
  if (q.to) { where.push('p.payment_date <= ?'); args.push(q.to); }
  if (q.min) { where.push('p.amount >= ?'); args.push(q.min); }
  if (q.max) { where.push('p.amount <= ?'); args.push(q.max); }
  const ord = orderBy(req, { date: 'p.payment_date', amount: 'p.amount', customer: 'c.name' }, 'p.id');
  const from = 'FROM payments p JOIN customers c ON c.id=p.customer_id LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN estimates e ON e.id=p.estimate_id LEFT JOIN users u ON u.id=p.created_by';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${from} WHERE ${where.join(' AND ')}`, args);
  const [rows] = await pool.query(
    `SELECT p.*, c.name AS customer_name, i.invoice_number, e.estimate_number, u.name AS created_by_name ${from} WHERE ${where.join(' AND ')} ORDER BY ${ord} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [[p]] = await pool.query(
    `SELECT p.*, c.name customer_name, i.invoice_number, e.estimate_number FROM payments p JOIN customers c ON c.id=p.customer_id
     LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN estimates e ON e.id=p.estimate_id WHERE p.id=? AND p.company_id=?`, [idNum.parse(req.params.id), req.user.company_id]);
  if (!p) throw notFound('Payment');
  ok(res, p);
}));

router.post('/', validate(paymentSchema), asyncHandler(async (req, res) => {
  const r = await withTransaction((conn) => ledger.recordPayment(conn, { companyId: req.user.company_id, user: req.user, req, payload: req.body }));
  ok(res, r);
}));

router.put('/:id', validate(z.object({ status: z.enum(['VALID', 'CANCELLED']).optional(), transaction_id: optStr(100), reference_number: optStr(100), bank: optStr(100), notes: optStr(1000) })), asyncHandler(async (req, res) => {
  if (req.body.status === 'CANCELLED' && req.user.role !== 'ADMIN') throw forbidden('Only an administrator can cancel a payment');
  const id = idNum.parse(req.params.id);
  await withTransaction((conn) => ledger.updatePayment(conn, { companyId: req.user.company_id, user: req.user, req, id, payload: req.body }));
  ok(res, { id });
}));

async function receipt(req, res) {
  const id = idNum.parse(req.params.id);
  const [[p]] = await pool.query('SELECT * FROM payments WHERE id=? AND company_id=?', [id, req.user.company_id]);
  if (!p) throw notFound('Payment');
  let d;
  if (p.invoice_id) { const i = await ledger.loadInvoice(pool, req.user.company_id, p.invoice_id); d = { customer_name: i.customer_name, number: i.invoice_number, grand_total: i.grand_total, balance_due: i.balance_due }; }
  else { const e = await ledger.loadEstimate(pool, req.user.company_id, p.estimate_id); d = { customer_name: e.customer_name, number: e.estimate_number, grand_total: e.grand_total, balance_due: e.balance_due }; }
  const company = await ledger.getCompany(pool, req.user.company_id);
  const buf = await receiptPdf(company, p, d);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${p.receipt_number || `receipt-${p.id}`}.pdf"` });
  res.send(buf);
}
router.get('/:id/receipt', asyncHandler(receipt));
router.post('/:id/receipt', asyncHandler(receipt));

void adminOnly;
module.exports = router;
