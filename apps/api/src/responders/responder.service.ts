import { pool } from '../db.js';

export type ResponderSummary = {
  id: string;
  name: string;
};

export async function listResponders(): Promise<ResponderSummary[]> {
  const result = await pool.query<ResponderSummary>(
    `SELECT id, name
     FROM users
     WHERE role = 'RESPONDER'
     ORDER BY LOWER(name), id`,
  );

  return result.rows;
}