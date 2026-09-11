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
  await pool.query(
    `WITH revoked AS (
       UPDATE auth_sessions SET revoked_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL RETURNING id
     ), stopped AS (
       UPDATE devices
       SET publishing_session_id = NULL,
           publishing_owner_session_id = NULL,
           publishing_lease_expires_at = NULL
       WHERE publishing_owner_session_id IN (SELECT id FROM revoked)
       RETURNING id
     )
     INSERT INTO camera_room_cleanup (device_id, publishing_session_id)
     SELECT d.id, d.publishing_session_id FROM devices d
     JOIN stopped s ON s.id = d.id
     WHERE d.publishing_session_id IS NOT NULL
     ON CONFLICT (device_id, publishing_session_id) DO NOTHING`,
    [sessionId],
  );
  notifyDevicesChanged();
}
