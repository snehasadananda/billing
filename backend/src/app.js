const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { pool } = require('./config/db');
const { authenticate, adminOnly } = require('./middleware/auth');
const { errorHandler, notFoundHandler } = require('./middleware/error');

const app = express();
if (env.trustProxy) app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin(origin, cb) { if (!origin || env.corsOrigins.includes(origin)) return cb(null, true); return cb(null, false); },
  credentials: false,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api', rateLimit({
  windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, message: 'Too many requests. Please slow down.', code: 'RATE_LIMITED' }),
}));

app.get('/api/health', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ success: true, status: 'ok' }); } catch (_) { res.status(503).json({ success: false, status: 'db_unavailable' }); }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', authenticate, adminOnly, require('./routes/users'));
app.use('/api/customers', authenticate, require('./routes/customers'));
app.use('/api/estimates', authenticate, require('./routes/estimates'));
app.use('/api/invoices', authenticate, require('./routes/invoices'));
app.use('/api/payments', authenticate, require('./routes/payments'));
app.use('/api/billing', authenticate, require('./routes/billing'));
app.use('/api/reports', authenticate, require('./routes/reports'));
app.use('/api/dashboard', authenticate, require('./routes/dashboard'));
app.use('/api/gst', authenticate, require('./routes/gst'));
app.use('/api/notifications', authenticate, require('./routes/notifications'));
app.use('/api/settings', authenticate, require('./routes/settings'));

app.use('/api', notFoundHandler);

// Optional: serve the built React app from this same Node process (SERVE_FRONTEND=true)
if (env.serveFrontend) {
  const dist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

app.use(errorHandler);
module.exports = app;
