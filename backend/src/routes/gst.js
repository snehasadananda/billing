const router = require('express').Router();
const { pool } = require('../config/db');
const { asyncHandler, validate, ok, z, idNum } = require('../utils/http');
const { numStr } = require('../utils/schemas');
const { adminOnly } = require('../middleware/auth');
const { notFound } = require('../utils/errors');
const { audit } = require('../utils/audit');

router.get('/rates', asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id, rate, label, is_active FROM gst_rates WHERE company_id=? ORDER BY rate', [req.user.company_id]);
  ok(res, rows);
}));

router.post('/rates', adminOnly, validate(z.object({ rate: numStr.refine((v) => Number(v) >= 0 && Number(v) <= 100, 'Rate must be 0-100'), label: z.string().trim().max(50).optional() })), asyncHandler(async (req, res) => {
  const label = req.body.label || `${Number(req.body.rate)}%`;
  const [r] = await pool.query('INSERT INTO gst_rates (company_id, rate, label) VALUES (?,?,?)', [req.user.company_id, req.body.rate, label]);
  await audit(pool, { req, action: 'CREATE', module: 'GST_RATE', recordId: r.insertId, newValue: { rate: req.body.rate } });
  ok(res, { id: r.insertId });
}));

router.put('/rates/:id', adminOnly, validate(z.object({ label: z.string().trim().max(50).optional(), is_active: z.boolean().optional() })), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  const [[g]] = await pool.query('SELECT * FROM gst_rates WHERE id=? AND company_id=?', [id, req.user.company_id]);
  if (!g) throw notFound('GST rate');
  await pool.query('UPDATE gst_rates SET label=?, is_active=? WHERE id=?', [req.body.label ?? g.label, req.body.is_active === undefined ? g.is_active : (req.body.is_active ? 1 : 0), id]);
  await audit(pool, { req, action: 'UPDATE', module: 'GST_RATE', recordId: id, oldValue: { label: g.label, is_active: g.is_active }, newValue: req.body });
  ok(res, { id });
}));

module.exports = router;
