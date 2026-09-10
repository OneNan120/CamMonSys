import { pool } from '../db.js';
import { env } from '../config.js';

type DeviceRow = {
  id: string;
  name: string;
  location: string;
  created_by_id: string;
  group_id: string | null;
  created_at: Date;
};

export type DeleteDeviceResult = | 'DELETED' | 'NOT_FOUND' | 'HAS_UNRESOLVED_EVENTS';

export async function createDevice(
  name: string,
  location: string,
  createdById: string,
) {
  const result = await pool.query<DeviceRow>(
    `INSERT INTO devices (name, location, created_by_id)
     VALUES ($1, $2, $3)
     RETURNING id, name, location, created_by_id, group_id, created_at`,
    [name, location, createdById],
  );

  const device = result.rows[0];

  if (!device) {
    throw new Error('Device creation returned no record.');
  }

  return device;
} 

export async function listDevices() {
  const result = await pool.query(
    `SELECT
       id,
       name,
       location,
       group_id,
       last_seen_at,
       publishing_session_id AS stream_version,
       created_at,
       CASE
         WHEN publishing_session_id IS NOT NULL
          AND last_seen_at > NOW() - ($1::integer * INTERVAL '1 second')
         THEN 'ONLINE'
         ELSE 'OFFLINE'
       END AS status
     FROM devices
     WHERE deleted_at IS NULL
     ORDER BY created_at DESC, id DESC`,
    [env.CAMERA_PUBLISHING_LEASE_SECONDS],
  );

  return result.rows;
}

export async function getDeviceById(deviceId: string) {
  const result = await pool.query(
    `SELECT
       id,
       name,
       location,
       group_id,
       last_seen_at,
       publishing_session_id AS stream_version,
       created_at,
       CASE
         WHEN publishing_session_id IS NOT NULL
          AND last_seen_at > NOW() - ($2::integer * INTERVAL '1 second')
         THEN 'ONLINE'
         ELSE 'OFFLINE'
       END AS status
     FROM devices
     WHERE id = $1
       AND deleted_at IS NULL`,
    [deviceId, env.CAMERA_PUBLISHING_LEASE_SECONDS],
  );

  return result.rows[0] ?? null;
}

export async function deleteDevice(
  deviceId: string,
  actorId: string,
): Promise<DeleteDeviceResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const deviceResult = await client.query<{
      publishing_session_id: string | null;
    }>(
      `SELECT publishing_session_id
       FROM devices
       WHERE id = $1
         AND deleted_at IS NULL
       FOR UPDATE`,
      [deviceId],
    );

    const device = deviceResult.rows[0];

    if (!device) {
      await client.query('ROLLBACK');
      return 'NOT_FOUND';
    }

    const unresolvedEvents = await client.query(
      `SELECT id
       FROM events
       WHERE device_id = $1
         AND status <> 'RESOLVED'
       LIMIT 1`,
      [deviceId],
    );

    if (unresolvedEvents.rowCount !== 0) {
      await client.query('ROLLBACK');
      return 'HAS_UNRESOLVED_EVENTS';
    }

    if (device.publishing_session_id) {
      await client.query(
        `INSERT INTO camera_room_cleanup (
           device_id,
           publishing_session_id
         )
         VALUES ($1, $2)
         ON CONFLICT (device_id, publishing_session_id) DO NOTHING`,
        [deviceId, device.publishing_session_id],
      );
    }

    await client.query(
      `UPDATE devices
       SET deleted_at = NOW(),
           publishing_session_id = NULL,
           publishing_owner_session_id = NULL,
           publishing_lease_expires_at = NULL
       WHERE id = $1`,
      [deviceId],
    );

    await client.query(
      `INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       VALUES ($1, 'DEVICE_DELETED', 'DEVICE', $2)`,
      [actorId, deviceId],
    );

    await client.query('COMMIT');
    return 'DELETED';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}