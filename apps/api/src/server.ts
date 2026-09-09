import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createApp } from './app.js';
import { env } from './config.js';

const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 3000, query_timeout: 3000 });
pool.on('error', () => console.error('An idle database connection failed.'));
const app = createApp(async () => { await pool.query('SELECT 1'); },
  fileURLToPath(new URL('../../web/dist', import.meta.url)));
const server = app.listen(env.PORT, '0.0.0.0', () => console.log('API listening on port ' + env.PORT));
function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => { void pool.end().then(() => process.exit(0)); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
