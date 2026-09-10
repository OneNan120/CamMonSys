import { pool } from '../db.js';

export type DeviceGroup = {
  id: string;
  name: string;
  created_at: Date;
};

export async function createDeviceGroup(
  name: string,
  actorId: string,
): Promise<DeviceGroup> {
  const result = await pool.query<DeviceGroup>(
    `WITH created_group AS (
       INSERT INTO device_groups (name)
       VALUES ($1)
       RETURNING id, name, created_at
     ),
     audit_entry AS (
       INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       SELECT
         $2::uuid,
         'DEVICE_GROUP_CREATED',
         'DEVICE_GROUP',
         id
       FROM created_group
       RETURNING id
     )
     SELECT created_group.*
     FROM created_group
     JOIN audit_entry ON TRUE`,
    [name, actorId],
  );

  const group = result.rows[0];

  if (!group) {
    throw new Error('Device-group creation returned no record.');
  }

  return group;
}

export async function listDeviceGroups(): Promise<DeviceGroup[]> {
  const result = await pool.query<DeviceGroup>(
    `SELECT id, name, created_at
     FROM device_groups
     ORDER BY LOWER(name), id`,
  );

  return result.rows;
}

export async function deleteDeviceGroup(
  groupId: string,
  actorId: string,
): Promise<DeviceGroup | null> {
  const result = await pool.query<DeviceGroup>(
    `WITH deleted_group AS (
       DELETE FROM device_groups
       WHERE id = $1
       RETURNING id, name, created_at
     ),
     audit_entry AS (
       INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       SELECT
         $2::uuid,
         'DEVICE_GROUP_DELETED',
         'DEVICE_GROUP',
         id
       FROM deleted_group
       RETURNING id
     )
     SELECT deleted_group.*
     FROM deleted_group
     JOIN audit_entry ON TRUE`,
    [groupId, actorId],
  );

  return result.rows[0] ?? null;
}