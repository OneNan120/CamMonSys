import { fileURLToPath } from 'node:url';
import { env } from './config.js';
import { createApp } from './app.js';
import { pool } from './db.js';
import { startRoomCleanupWorker } from './video/room-cleanup.worker.js';
import { closeMonitoringStreams } from './monitoring/monitoring-events.js';

await pool.query('SELECT 1');

const app = createApp(async () => 
  { await pool.query('SELECT 1'); },
  fileURLToPath(new URL('../../web/dist', import.meta.url)));
  
const server = app.listen(env.PORT, '0.0.0.0', () => console.log('API listening on port ' + env.PORT));

const stopRoomCleanupWorker = startRoomCleanupWorker();

function shutdown() {
  closeMonitoringStreams();
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  server.close(() => {
    void (async () => {
      try {
        await stopRoomCleanupWorker();
        await pool.end();
        process.exit(0);
      } catch {
        console.error('Application shutdown failed.');
        process.exit(1);
      }
    })();
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
