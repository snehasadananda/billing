const { AppError } = require('../utils/errors');

function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}`, code: 'ROUTE_NOT_FOUND' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ success: false, message: err.message, code: err.code, details: err.details });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'Invalid JSON in request body', code: 'BAD_JSON' });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ success: false, message: 'Request is too large', code: 'PAYLOAD_TOO_LARGE' });
  if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
    return res.status(409).json({ success: false, message: 'This record already exists (duplicate value).', code: 'DUPLICATE_ENTRY' });
  }
  if (err && (err.errno === 1213 || err.errno === 1205)) {
    return res.status(503).json({ success: false, message: 'The system is busy. Please try again.', code: 'DB_BUSY' });
  }
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err); // technical detail stays server-side
  return res.status(500).json({ success: false, message: 'Something went wrong. Please try again.', code: 'INTERNAL_ERROR' });
}

module.exports = { errorHandler, notFoundHandler };
