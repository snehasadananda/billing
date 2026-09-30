const router = require('express').Router();
const { pool, withTransaction } = require('../config/db');
const { asyncHandler, validate, ok, z, idNum, pageParams, orderBy } = require('../utils/http');
const { estimateSchema } = require('../utils/schemas');
const { today } = require('../utils/dates');
const ledger = require('../services/ledger');
const { documentPdf } = require('../services/pdf');
const { sendMail } = require('../services/mailer');
const { getSettings } = require('../services/settings');
const { AppError } = require('../utils/errors');

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req); const cid = req.user.company_id; const q = req.query;
  await ledger.refreshStatuses(pool, cid);
  const where = ['e.company_id=?']; const args = [cid];
  if (q.q) { const l = `%${q.q}%`; where.push('(e.estimate_number LIKE ? OR e.customer_name LIKE ? OR c.mobile LIKE ? OR c.email LIKE ?)'); args.push(l, l, l, l); }
  if (q.status) { where.push('e.status=?'); args.push(q.status); }
  if (q.customer_id) { where.push('e.customer_id=?'); args.push(Number(q.customer_id)); }
  if (q.from) { where.push('e.estimate_date >= ?'); args.push(q.from); }
  if (q.to) { where.push('e.estimate_date <= ?'); args.push(q.to); }
  if (q.min) { where.push('e.grand_total >= ?'); args.push(q.min); }
  if (q.max) { where.push('e.grand_total <= ?'); args.push(q.max); }
  const ord = orderBy(req, { date: 'e.estimate_date', number: 'e.estimate_number', total: 'e.grand_total', customer: 'e.customer_name', status: 'e.status' }, 'e.id');
  const from = 'FROM estimates e LEFT JOIN customers c ON c.id = e.customer_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total ${from} WHERE ${where.join(' AND ')}`, args);
  const [rows] = await pool.query(
    `SELECT e.id, e.estimate_number, e.estimate_date, e.valid_until, e.due_date, e.customer_id, e.customer_name, e.grand_total, e.amount_paid, e.balance_due, e.status, e.billing_cycle_id,
       (e.balance_due > 0 AND e.due_date < ? AND e.status IN ('AUTO_GENERATED','SENT','VIEWED','ACCEPTED','PAYMENT_PENDING')) AS is_overdue
     ${from} WHERE ${where.join(' AND ')} ORDER BY ${ord} LIMIT ? OFFSET ?`, [today(), ...args, limit, offset]);
  ok(res, rows.map((r) => ({ ...r, is_overdue: !!r.is_overdue })), { pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  ok(res, await ledger.loadEstimate(pool, req.user.company_id, idNum.parse(req.params.id)));
}));

router.post('/', validate(estimateSchema), asyncHandler(async (req, res) => {
  const r = await withTransaction((conn) => ledger.createEstimate(conn, { companyId: req.user.company_id, user: req.user, req, payload: req.body }));
  ok(res, r);
}));

router.put('/:id', validate(estimateSchema), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  await withTransaction((conn) => ledger.updateEstimate(conn, { companyId: req.user.company_id, user: req.user, req, id, payload: req.body }));
  ok(res, { id });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); // financial documents are cancelled, never physically deleted
  const status = await withTransaction((conn) => ledger.changeEstimateStatus(conn, { companyId: req.user.company_id, user: req.user, req, id, action: 'cancel' }));
  ok(res, { id, status });
}));

async function pdfFor(req, id) {
  const e = await ledger.loadEstimate(pool, req.user.company_id, id);
  const company = await ledger.getCompany(pool, req.user.company_id);
  return { e, company, buf: await documentPdf('ESTIMATE', company, e) };
}

router.post('/:id/send', validate(z.object({ email: z.boolean().optional(), to: z.string().email().optional() })), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id); let emailed = false;
  if (req.body.email) {
    const { e, company, buf } = await pdfFor(req, id);
    const [[c]] = await pool.query('SELECT email FROM customers WHERE id=?', [e.customer_id]);
    const to = req.body.to || (c && c.email);
    if (!to) throw new AppError(400, 'NO_EMAIL', 'This customer has no email address');
    await sendMail({ to, subject: `Estimate ${e.estimate_number} from ${company.name}`, text: `Dear ${e.customer_name},\n\nPlease find attached estimate ${e.estimate_number} for Rs. ${e.grand_total}.\n\nRegards,\n${company.name}`, attachments: [{ filename: `${e.estimate_number}.pdf`, content: buf }] });
    emailed = true;
  }
  const status = await withTransaction((conn) => ledger.changeEstimateStatus(conn, { companyId: req.user.company_id, user: req.user, req, id, action: 'send', sentByEmail: emailed }));
  ok(res, { id, status, emailed });
}));

for (const action of ['accept', 'reject']) {
  router.post(`/:id/${action}`, asyncHandler(async (req, res) => {
    const id = idNum.parse(req.params.id);
    const status = await withTransaction((conn) => ledger.changeEstimateStatus(conn, { companyId: req.user.company_id, user: req.user, req, id, action }));
    ok(res, { id, status });
  }));
}

router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  const status = await withTransaction((conn) => ledger.changeEstimateStatus(conn, { companyId: req.user.company_id, user: req.user, req, id, action: 'cancel' }));
  ok(res, { id, status });
}));

router.post('/:id/convert', asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  const inv = await withTransaction((conn) => ledger.convertEstimate(conn, { companyId: req.user.company_id, user: req.user, req, estimateId: id }));
  ok(res, inv);
}));

router.get('/:id/pdf', asyncHandler(async (req, res) => {
  const { e, buf } = await pdfFor(req, idNum.parse(req.params.id));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${e.estimate_number}.pdf"` });
  res.send(buf);
}));

void getSettings;
module.exports = router;
