import { pool } from '../db.js';
import { disconnectResponderFromCamera } from './livekit.service.js';

// Recheck current access on every retry: a new assignment may restore it.
export async function processResponderRevocations() {
  const pending = await pool.query<{
    id: string; device_id: string; publishing_session_id: string; responder_id: string;
  }>('SELECT * FROM camera_responder_revocations ORDER BY created_at, id LIMIT 20');
  for (const record of pending.rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM devices WHERE id = $1 FOR UPDATE', [record.device_id]);
      const access = await client.query(
        `SELECT id FROM events WHERE device_id = $1
         AND assigned_to_id = $2 AND status <> 'RESOLVED' LIMIT 1`,
        [record.device_id, record.responder_id],
      );
      if (access.rowCount === 0) {
        await disconnectResponderFromCamera(
          record.device_id, record.publishing_session_id, record.responder_id,
        );
      }
      await client.query('DELETE FROM camera_responder_revocations WHERE id = $1', [record.id]);
      await client.query('COMMIT');
    } catch {
      await client.query('ROLLBACK');
      console.error('Responder access cleanup will retry.', { cleanupId: record.id });
    } finally {
      client.release();
    }
  }
}
