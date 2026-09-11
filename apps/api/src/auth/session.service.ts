import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { notifyDevicesChanged } from '../monitoring/monitoring-events.js';
import {
  createToken,
  SESSION_DURATION_SECONDS,
} from './token.js';

export async function createLoginSession(userId: string) {
  const sessionId = randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_DURATION_SECONDS * 1000,
  );

  const token = createToken(userId, sessionId, expiresAt);

  await pool.query(
    `INSERT INTO auth_sessions (id, user_id, expires_at)
     VALUES ($1, $2, $3)`,
    [sessionId, userId, expiresAt],
  );

  return { token, expiresAt };
}

export async function revokeLoginSession(sessionId: string) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const revoked = await client.query(
      `UPDATE auth_sessions
       SET revoked_at = NOW()
       WHERE id = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [sessionId],
    );

    if (revoked.rowCount === 1) {
      const publications = await client.query<{
        id: string;
        publishing_session_id: string;
      }>(
        `SELECT id, publishing_session_id
         FROM devices
         WHERE publishing_owner_session_id = $1
           AND publishing_session_id IS NOT NULL
         FOR UPDATE`,
        [sessionId],
      );

      for (const publication of publications.rows) {
        await client.query(
          `INSERT INTO camera_room_cleanup (device_id, publishing_session_id)
           VALUES ($1, $2)
           ON CONFLICT (device_id, publishing_session_id) DO NOTHING`,
          [publication.id, publication.publishing_session_id],
        );
      }

      await client.query(
        `UPDATE devices
         SET publishing_session_id = NULL,
             publishing_owner_session_id = NULL,
             publishing_lease_expires_at = NULL
         WHERE publishing_owner_session_id = $1`,
        [sessionId],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  notifyDevicesChanged();
}
