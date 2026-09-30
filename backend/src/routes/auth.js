const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { pool } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { asyncHandler, validate, ok, z } = require('../utils/http');
const { AppError } = require('../utils/errors');
const { audit } = require('../utils/audit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many login attempts. Please try again in a few minutes.', code: 'RATE_LIMITED' }),
});

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', loginLimiter, validate(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const [[u]] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    const match = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH); // constant-ish time
    if (!u || !match || u.status !== 'ACTIVE') {
      await audit(pool, { req, companyId: u && u.company_id, user: u ? { id: u.id } : null, action: 'LOGIN_FAILED', module: 'AUTH', recordId: u ? u.id : null, newValue: { email } });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    }
    await pool.query('UPDATE users SET last_login=UTC_TIMESTAMP() WHERE id=?', [u.id]);
    await audit(pool, { req, user: u, companyId: u.company_id, action: 'LOGIN', module: 'AUTH', recordId: u.id });
    const token = jwt.sign({ sub: u.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn, algorithm: 'HS256' });
    ok(res, { token, user: { id: u.id, name: u.name, email: u.email, role: u.role } });
  }));

router.post('/logout', authenticate, asyncHandler(async (req, res) => {
  await audit(pool, { req, action: 'LOGOUT', module: 'AUTH', recordId: req.user.id });
  ok(res, { loggedOut: true }); // JWT is stateless; the client discards the token
}));

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const [[c]] = await pool.query('SELECT id, name, logo, state FROM companies WHERE id=?', [req.user.company_id]);
  ok(res, { user: { id: req.user.id, name: req.user.name, email: req.user.email, mobile: req.user.mobile, role: req.user.role }, company: c });
}));

router.post('/change-password', authenticate, validate(z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8, 'Password must be at least 8 characters').max(100)
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain letters and numbers'),
})), asyncHandler(async (req, res) => {
  const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!(await bcrypt.compare(req.body.current_password, u.password_hash))) throw new AppError(400, 'WRONG_PASSWORD', 'Current password is incorrect');
  await pool.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(req.body.new_password, 12), req.user.id]);
  await audit(pool, { req, action: 'CHANGE_PASSWORD', module: 'AUTH', recordId: req.user.id });
  ok(res, { changed: true });
}));

module.exports = router;
