import { fileURLToPath } from 'node:url';
import { env } from './config.js';
import { createApp } from './app.js';
import { pool } from './db.js';

await pool.query('SELECT 1');

const app = createApp(async () => 
  { await pool.query('SELECT 1'); },
  fileURLToPath(new URL('../../web/dist', import.meta.url)));
  
const server = app.listen(env.PORT, '0.0.0.0', () => console.log('API listening on port ' + env.PORT));

function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => { void pool.end().then(() => process.exit(0)); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
