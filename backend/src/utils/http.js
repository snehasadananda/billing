const { z } = require('zod');
const { badRequest } = require('./errors');

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Validate req[source] with a zod schema; replaces it with the parsed (coerced) value. */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(badRequest('VALIDATION_ERROR', `${details[0].field ? details[0].field + ': ' : ''}${details[0].message}`, details));
  }
  req[source] = result.data;
  return next();
};

function pageParams(req, defaultLimit = 25) {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defaultLimit, 1), 200);
  return { page, limit, offset: (page - 1) * limit };
}

/** Returns a safe ORDER BY clause from a whitelist. */
function orderBy(req, allowed, fallback) {
  const col = allowed[req.query.sort] || fallback;
  const dir = String(req.query.order || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir}`;
}

const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });

// Reusable zod field helpers
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optStr = (max = 500) => z.string().trim().max(max).optional().nullable().transform((v) => (v === '' || v === undefined ? null : v));
const idNum = z.coerce.number().int().positive();

module.exports = { asyncHandler, validate, pageParams, orderBy, ok, dateStr, optStr, idNum, z };
