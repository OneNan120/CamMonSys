import { pool } from '../db.js';
import { closeCameraRoom } from './livekit.service.js';

type CleanupRecord = {
  id: string;
  device_id: string;
  publishing_session_id: string;
};

export async function processRoomCleanup() {
  const result = await pool.query<CleanupRecord>(
    `SELECT id, device_id, publishing_session_id
     FROM camera_room_cleanup
     ORDER BY created_at, id
     LIMIT 20`,
  );

  for (const record of result.rows) {
    try {
      await closeCameraRoom(
        record.device_id,
        record.publishing_session_id,
      );

      await pool.query(
        'DELETE FROM camera_room_cleanup WHERE id = $1',
        [record.id],
      );
    } catch {
      // Leave the record in place for a later retry.
      console.error('Camera room cleanup failed.', {
        cleanupId: record.id,
      });
    }
  }
}