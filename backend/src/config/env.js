const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes'].includes(String(v).toLowerCase()));

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '5000', 10),
  timezone: process.env.APP_TIMEZONE || 'Asia/Kolkata',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  serveFrontend: bool(process.env.SERVE_FRONTEND, false),
  trustProxy: process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY, 10) : 0,
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'billing',
  },
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  admin: {
    name: process.env.ADMIN_NAME || 'Administrator',
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'ChangeMe@123',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'Billing <no-reply@example.com>',
  },
  enableScheduler: bool(process.env.ENABLE_SCHEDULER, true),
  backupDir: path.resolve(process.env.BACKUP_DIR || './backups'),
};

if (!env.jwtSecret || env.jwtSecret.length < 32) {
  if (env.nodeEnv === 'production') {
    console.error('FATAL: JWT_SECRET must be set to a random string of at least 32 characters.');
    process.exit(1);
  } else {
    env.jwtSecret = env.jwtSecret || 'dev-only-insecure-secret-change-me-please-0123456789';
    console.warn('WARN: using an insecure development JWT secret.');
  }
}

module.exports = env;
