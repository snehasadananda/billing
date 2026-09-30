const router = require('express').Router();
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, validate, ok, z, idNum, pageParams, orderBy, optStr, dateStr } = require('../utils/http');
const { invoiceSchema } = require('../utils/schemas');
const ledger = require('../services/ledger');
const { documentPdf } = require('../services/pdf');
const { sendMail } = require('../services/mailer');
const { adminOnly } = require('../middleware/auth');
const { AppError } = require('../utils/errors');

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req); const cid = req.user.company_id; const q = req.query;
  await ledger.refreshStatuses(pool, cid);
  const where = ['i.company_id=?']; const args = [cid];
  if (q.q) { const l = `%${q.q}%`; where.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?)'); args.push(l, l, l, l); }
  if (q.status) { where.push('i.status=?'); args.push(q.status); }
  if (q.payment_status === 'paid') where.push("i.status='PAID'");
  if (q.payment_status === 'unpaid') where.push("i.balance_due > 0 AND i.status NOT IN ('CANCELLED','VOID')");
  if (q.customer_id) { where.push('i.customer_id=?'); args.push(Number(q.customer_id)); }
  if (q.from) { where.push('i.invoice_date >= ?'); args.push(q.from); }
  if (q.to) { where.push('i.invoice_date <= ?'); args.push(q.to); }
  if (q.min) { where.push('i.grand_total >= ?'); args.push(q.min); }
  if (q.max) { where.push('i.grand_total <= ?'); args.push(q.max); }
  const ord = orderBy(req, { date: 'i.invoice_date', number: 'i.invoice_number', total: 'i.grand_total', customer: 'i.customer_name', status: 'i.status', due: 'i.due_date' }, 'i.id');
  const from = 'FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${from} WHERE ${where.join(' AND ')}`, args);
  const [rows] = await pool.query(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, i.customer_id, i.customer_name, i.grand_total, i.amount_paid, i.balance_due, i.status, i.estimate_id
     ${from} WHERE ${where.join(' AND ')} ORDER BY ${ord} LIMIT ? OFFSET ?`, [...args, limit, offset]);
  ok(res, rows, { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req, res) => ok(res, await ledger.loadInvoice(pool, req.user.company_id, idNum.parse(req.params.id)))));

router.get('/:id/payments', asyncHandler(async (req, res) => {
  const inv = await ledger.loadInvoice(pool, req.user.company_id, idNum.parse(req.params.id));
  ok(res, inv.payments);
}));

router.post('/', validate(invoiceSchema), asyncHandler(async (req, res) => {
  const r = await withTransaction((conn) => ledger.createInvoice(conn, { companyId: req.user.company_id, user: req.user, req, payload: req.body }));
  ok(res, r);
}));

router.put('/:id', validate(z.object({ notes: optStr(2000), terms: optStr(5000), due_date: dateStr.optional() })), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  await withTransaction((conn) => ledger.updateInvoice(conn, { companyId: req.user.company_id, user: req.user, req, id, payload: req.body }));
  ok(res, { id });
}));

for (const [path, type] of [['cancel', 'CANCELLED'], ['void', 'VOID']]) {
  router.post(`/:id/${path}`, adminOnly, validate(z.object({ reason: optStr(300) })), asyncHandler(async (req, res) => {
    const id = idNum.parse(req.params.id);
    const status = await withTransaction((conn) => ledger.cancelInvoice(conn, { companyId: req.user.company_id, user: req.user, req, id, reason: req.body.reason, type }));
    ok(res, { id, status });
  }));
}

async function pdfFor(req, id) {
  const inv = await ledger.loadInvoice(pool, req.user.company_id, id);
  const company = await ledger.getCompany(pool, req.user.company_id);
  return { inv, company, buf: await documentPdf('INVOICE', company, inv) };
}

router.get('/:id/pdf', asyncHandler(async (req, res) => {
  const { inv, buf } = await pdfFor(req, idNum.parse(req.params.id));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${inv.invoice_number}.pdf"` });
  res.send(buf);
}));

router.post('/:id/email', validate(z.object({ to: z.string().email().optional() })), asyncHandler(async (req, res) => {
  const { inv, company, buf } = await pdfFor(req, idNum.parse(req.params.id));
  const [[c]] = await pool.query('SELECT email FROM customers WHERE id=?', [inv.customer_id]);
  const to = req.body.to || (c && c.email);
  if (!to) throw new AppError(400, 'NO_EMAIL', 'This customer has no email address');
  await sendMail({ to, subject: `Invoice ${inv.invoice_number} from ${company.name}`, text: `Dear ${inv.customer_name},\n\nPlease find attached invoice ${inv.invoice_number}. Balance due: Rs. ${inv.balance_due}.\n\nRegards,\n${company.name}`, attachments: [{ filename: `${inv.invoice_number}.pdf`, content: buf }] });
  ok(res, { emailed: true, to });
}));

module.exports = router;
