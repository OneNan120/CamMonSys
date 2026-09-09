import { pool } from '../db.js';

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