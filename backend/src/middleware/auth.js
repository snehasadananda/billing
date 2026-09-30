const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { pool } = require('../config/db');
const { AppError, forbidden } = require('../utils/errors');

async function authenticate(req, _res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please sign in to continue');
    let payload;
    try { payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }); } catch (_) { throw new AppError(401, 'INVALID_TOKEN', 'Your session has expired. Please sign in again.'); }
    const [[u]] = await pool.query('SELECT id, company_id, name, email, mobile, role, status FROM users WHERE id=?', [payload.sub]);
    if (!u || u.status !== 'ACTIVE') throw new AppError(401, 'ACCOUNT_DISABLED', 'This account is not active');
    req.user = u;
    next();
  } catch (e) { next(e); }
}

const requireRole = (...roles) => (req, _res, next) => (roles.includes(req.user.role) ? next() : next(forbidden()));
const adminOnly = requireRole('ADMIN');

module.exports = { authenticate, requireRole, adminOnly };
