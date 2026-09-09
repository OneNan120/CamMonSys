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