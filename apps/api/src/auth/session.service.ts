import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
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
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE id = $1
       AND revoked_at IS NULL`,
    [sessionId],
  );
}