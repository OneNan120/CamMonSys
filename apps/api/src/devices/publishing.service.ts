import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { env } from '../config.js';

export const PUBLISHING_LEASE_SECONDS = env.CAMERA_PUBLISHING_LEASE_SECONDS;

type ReservedDevice = {
  id: string;
  publishing_session_id: string;
  publishing_lease_expires_at: Date;
};

type LockedDevice = {
  publishing_session_id: string | null;
  lease_active: boolean;
};

export async function reservePublishingSession(
  deviceId: string,
  ownerSessionId: string,
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const existing = await client.query<LockedDevice>(
      `SELECT
         publishing_session_id,
         (
           publishing_session_id IS NOT NULL
           AND publishing_lease_expires_at IS NOT NULL
           AND publishing_lease_expires_at > clock_timestamp()
         ) AS lease_active
       FROM devices
       WHERE id = $1
         AND deleted_at IS NULL
       FOR UPDATE`,
      [deviceId],
    );

    const device = existing.rows[0];

    if (!device || device.lease_active) {
      await client.query('ROLLBACK');
      return null;
    }

    const publishingSessionId = randomUUID();

    const result = await client.query<ReservedDevice>(
      `UPDATE devices
       SET publishing_session_id = $2,
           publishing_owner_session_id = $3,
           publishing_lease_expires_at =
             clock_timestamp() + ($4::integer * INTERVAL '1 second')
       WHERE id = $1
       RETURNING
         id,
         publishing_session_id,
         publishing_lease_expires_at`,
      [
        deviceId,
        publishingSessionId,
        ownerSessionId,
        PUBLISHING_LEASE_SECONDS,
      ],
    );

    const reservation = result.rows[0];

    if (!reservation) {
      throw new Error('Reservation update returned no device.');
    }

    if (device.publishing_session_id) {
        await client.query(
            `INSERT INTO camera_room_cleanup
            (device_id, publishing_session_id)
            VALUES ($1, $2)
            ON CONFLICT (device_id, publishing_session_id) DO NOTHING`,
            [deviceId, device.publishing_session_id],
        );
    }

    await client.query('COMMIT');

    return {
      ...reservation,
      previousPublishingSessionId: device.publishing_session_id,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function releasePublishingSession(
  deviceId: string,
  publishingSessionId: string,
  ownerSessionId: string,
) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const released = await client.query(
      `UPDATE devices
       SET publishing_session_id = NULL,
           publishing_owner_session_id = NULL,
           publishing_lease_expires_at = NULL
       WHERE id = $1
         AND publishing_session_id = $2
         AND publishing_owner_session_id = $3
       RETURNING id`,
      [deviceId, publishingSessionId, ownerSessionId],
    );

    if (released.rowCount !== 1) {
      await client.query('ROLLBACK');
      return false;
    }

    await client.query(
      `INSERT INTO camera_room_cleanup
         (device_id, publishing_session_id)
       VALUES ($1, $2)
       ON CONFLICT (device_id, publishing_session_id) DO NOTHING`,
      [deviceId, publishingSessionId],
    );

    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function renewPublishingSession(
  deviceId: string,
  publishingSessionId: string,
  ownerSessionId: string,
) {
  const result = await pool.query(
    `UPDATE devices
     SET last_seen_at = clock_timestamp(),
         publishing_lease_expires_at =
           clock_timestamp() + ($4::integer * INTERVAL '1 second')
     WHERE id = $1
       AND publishing_session_id = $2
       AND publishing_owner_session_id = $3
       AND publishing_lease_expires_at > clock_timestamp()
       AND deleted_at IS NULL
     RETURNING id, last_seen_at, publishing_lease_expires_at`,
    [
      deviceId,
      publishingSessionId,
      ownerSessionId,
      PUBLISHING_LEASE_SECONDS,
    ],
  );

  return result.rows[0] ?? null;
}

export async function expirePublishingSessions() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const expired = await client.query<{
      id: string;
      publishing_session_id: string;
    }>(
      `SELECT id, publishing_session_id
       FROM devices
       WHERE publishing_session_id IS NOT NULL
         AND (
           publishing_lease_expires_at IS NULL
           OR publishing_lease_expires_at <= clock_timestamp()
         )
       ORDER BY publishing_lease_expires_at NULLS FIRST, id
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
    );

    for (const device of expired.rows) {
      await client.query(
        `INSERT INTO camera_room_cleanup
           (device_id, publishing_session_id)
         VALUES ($1, $2)
         ON CONFLICT (device_id, publishing_session_id) DO NOTHING`,
        [device.id, device.publishing_session_id],
      );

      await client.query(
        `UPDATE devices
         SET publishing_session_id = NULL,
             publishing_owner_session_id = NULL,
             publishing_lease_expires_at = NULL
         WHERE id = $1`,
        [device.id],
      );
    }

    await client.query('COMMIT');
    return expired.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getActivePublishingSession(deviceId: string) {
  const result = await pool.query<{
    publishing_session_id: string;
  }>(
    `SELECT publishing_session_id
     FROM devices
     WHERE id = $1
       AND deleted_at IS NULL
       AND publishing_session_id IS NOT NULL
       AND publishing_lease_expires_at > clock_timestamp()
       AND last_seen_at >
         clock_timestamp() - ($2::integer * INTERVAL '1 second')`,
    [deviceId, PUBLISHING_LEASE_SECONDS],
  );

  return result.rows[0] ?? null;
}