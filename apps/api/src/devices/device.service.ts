import { pool } from '../db.js';
import { env } from '../config.js';

export type DeviceRow = {
  id: string;
  name: string;
  location: string;
  created_by_id: string;
  group_id: string | null;
  created_at: Date;
};

export type DeleteDeviceResult = | 'DELETED' | 'NOT_FOUND' | 'HAS_UNRESOLVED_EVENTS';

type DeviceGroupAssignment = {
  id: string;
  group_id: string | null;
};

export type AssignDeviceGroupResult =
  | {
      status: 'UPDATED';
      device: DeviceGroupAssignment;
    }
  | {
      status: 'NOT_FOUND';
    }
  | {
      status: 'GROUP_NOT_FOUND';
    };

export type CreateDeviceResult =
  | {
      status: 'CREATED';
      device: DeviceRow;
    }
  | {
      status: 'GROUP_NOT_FOUND';
    };
    
export async function createDevice(
  name: string,
  location: string,
  createdById: string,
  groupId: string | null,
): Promise<CreateDeviceResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    if (groupId) {
      const group = await client.query(
        `SELECT id
         FROM device_groups
         WHERE id = $1
         FOR KEY SHARE`,
        [groupId],
      );

      if (group.rowCount !== 1) {
        await client.query('ROLLBACK');

        return {
          status: 'GROUP_NOT_FOUND',
        };
      }
    }

    const result = await client.query<DeviceRow>(
      `INSERT INTO devices (
         name,
         location,
         created_by_id,
         group_id
       )
       VALUES ($1, $2, $3, $4)
       RETURNING
         id,
         name,
         location,
         created_by_id,
         group_id,
         created_at`,
      [name, location, createdById, groupId],
    );

    const device = result.rows[0];

    if (!device) {
      throw new Error('Device creation returned no record.');
    }

    await client.query('COMMIT');

    return {
      status: 'CREATED',
      device,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
          AND publishing_lease_expires_at > NOW()
          AND (publishing_started_at IS NULL OR last_seen_at >= publishing_started_at)
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
          AND publishing_lease_expires_at > NOW()
          AND (publishing_started_at IS NULL OR last_seen_at >= publishing_started_at)
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

export async function assignDeviceGroup(
  deviceId: string,
  groupId: string | null,
  actorId: string,
): Promise<AssignDeviceGroupResult> {
  const result = await pool.query<DeviceGroupAssignment>(
    `WITH updated_device AS (
       UPDATE devices
       SET group_id = $2::uuid
       WHERE id = $1
         AND deleted_at IS NULL
         AND (
           $2::uuid IS NULL
           OR EXISTS (
             SELECT 1
             FROM device_groups
             WHERE id = $2::uuid
           )
         )
       RETURNING id, group_id
     ),
     audit_entry AS (
       INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       SELECT
         $3::uuid,
         CASE
           WHEN $2::uuid IS NULL
             THEN 'DEVICE_GROUP_REMOVED'
           ELSE 'DEVICE_GROUP_ASSIGNED'
         END,
         'DEVICE',
         id
       FROM updated_device
       RETURNING id
     )
     SELECT updated_device.*
     FROM updated_device
     JOIN audit_entry ON TRUE`,
    [deviceId, groupId, actorId],
  );

  const device = result.rows[0];

  if (device) {
    return {
      status: 'UPDATED',
      device,
    };
  }

  const existingDevice = await pool.query(
    `SELECT id
     FROM devices
     WHERE id = $1
       AND deleted_at IS NULL`,
    [deviceId],
  );

  return {
    status:
      existingDevice.rowCount === 1
        ? 'GROUP_NOT_FOUND'
        : 'NOT_FOUND',
  };
}
