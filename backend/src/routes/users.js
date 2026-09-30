const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const { asyncHandler, validate, ok, z, optStr, idNum } = require('../utils/http');
const { badRequest, notFound } = require('../utils/errors');
const { audit } = require('../utils/audit');

const pw = z.string().min(8, 'Password must be at least 8 characters').max(100).refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers');
const createSchema = z.object({ name: z.string().trim().min(1).max(150), email: z.string().trim().toLowerCase().email(), mobile: optStr(30), role: z.enum(['ADMIN', 'STAFF']).default('STAFF'), password: pw });
const updateSchema = z.object({ name: z.string().trim().min(1).max(150).optional(), mobile: optStr(30), role: z.enum(['ADMIN', 'STAFF']).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), password: pw.optional() });

const cols = 'id, name, email, mobile, role, status, last_login, created_at, updated_at';

router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT ${cols} FROM users WHERE company_id=? ORDER BY name`, [req.user.company_id]);
  ok(res, rows);
}));

router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
  const b = req.body;
  const [r] = await pool.query('INSERT INTO users (company_id, name, email, mobile, password_hash, role) VALUES (?,?,?,?,?,?)',
    [req.user.company_id, b.name, b.email, b.mobile, await bcrypt.hash(b.password, 12), b.role]);
  await audit(pool, { req, action: 'CREATE', module: 'USER', recordId: r.insertId, newValue: { email: b.email, role: b.role } });
  ok(res, { id: r.insertId });
}));

router.put('/:id', validate(updateSchema), asyncHandler(async (req, res) => {
  const id = idNum.parse(req.params.id);
  const [[u]] = await pool.query('SELECT * FROM users WHERE id=? AND company_id=?', [id, req.user.company_id]);
  if (!u) throw notFound('User');
  const b = req.body;
  if (id === req.user.id && ((b.status && b.status !== 'ACTIVE') || (b.role && b.role !== 'ADMIN'))) throw badRequest('SELF_LOCKOUT', 'You cannot deactivate or demote your own account');
  const [[{ admins }]] = await pool.query("SELECT COUNT(*) admins FROM users WHERE company_id=? AND role='ADMIN' AND status='ACTIVE' AND id<>?", [req.user.company_id, id]);
  if (admins === 0 && ((b.status && b.status !== 'ACTIVE') || (b.role && b.role !== 'ADMIN'))) throw badRequest('LAST_ADMIN', 'At least one active administrator is required');
  await pool.query('UPDATE users SET name=?, mobile=?, role=?, status=?, password_hash=? WHERE id=?',
    [b.name ?? u.name, b.mobile !== undefined ? b.mobile : u.mobile, b.role ?? u.role, b.status ?? u.status, b.password ? await bcrypt.hash(b.password, 12) : u.password_hash, id]);
  await audit(pool, { req, action: b.password ? 'UPDATE_PASSWORD_RESET' : 'UPDATE', module: 'USER', recordId: id, oldValue: { role: u.role, status: u.status }, newValue: { role: b.role, status: b.status } });
  ok(res, { id });
}));

module.exports = router;
