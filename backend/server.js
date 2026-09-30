const env = require('./src/config/env');
const app = require('./src/app');
const { pool } = require('./src/config/db');
const scheduler = require('./src/jobs/scheduler');

const server = app.listen(env.port, () => {
  console.log(`Billing API listening on port ${env.port} (${env.nodeEnv})`);
  scheduler.start();
});

async function shutdown(sig) {
  console.log(`${sig} received, shutting down...`);
  server.close(async () => { try { await pool.end(); } catch (_) { /* ignore */ } process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));
