const router = require('express').Router();
const { asyncHandler, ok } = require('../utils/http');
const { notFound } = require('../utils/errors');
const { runReport } = require('../services/reports');
const { reportPdf } = require('../services/pdf');
const { getCompany } = require('../services/ledger');
const { pool } = require('../config/db');

router.get('/:type', asyncHandler(async (req, res) => {
  const rep = await runReport(req.user.company_id, req.params.type, req.query);
  if (!rep) throw notFound('Report');
  ok(res, rep);
}));

router.get('/:type/pdf', asyncHandler(async (req, res) => {
  const rep = await runReport(req.user.company_id, req.params.type, req.query);
  if (!rep) throw notFound('Report');
  const company = await getCompany(pool, req.user.company_id);
  const buf = await reportPdf(company, rep);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${req.params.type}-report.pdf"` });
  res.send(buf);
}));

router.get('/:type/csv', asyncHandler(async (req, res) => {
  const rep = await runReport(req.user.company_id, req.params.type, req.query);
  if (!rep) throw notFound('Report');
  const esc = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; // also neutralises CSV/Excel formula injection
  const lines = [rep.columns.map((c) => esc(c.label)).join(',')];
  rep.rows.forEach((r) => lines.push(rep.columns.map((c) => esc(r[c.key])).join(',')));
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${req.params.type}-report.csv"` });
  res.send(`\uFEFF${lines.join('\r\n')}`);
}));

module.exports = router;
