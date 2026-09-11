import { pool } from '../db.js';
import { hashPassword } from '../auth/password.js';

export type UserRole = 'ADMIN' | 'MONITOR' | 'RESPONDER';

export type UserSummary = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at: Date;
};

export async function listUsers() {
  const result = await pool.query<UserSummary>(
    `SELECT id, name, email, role, created_at
     FROM users
     ORDER BY LOWER(name), id`,
  );

  return result.rows;
}

export async function createUser(
  input: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  },
  actorId: string,
) {
  const passwordHash = await hashPassword(input.password);

  const result = await pool.query<UserSummary>(
    `WITH created_user AS (
       INSERT INTO users (
         name,
         email,
         password_hash,
         role
       )
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at
     ),
     audit_entry AS (
       INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       SELECT
         $5::uuid,
         'USER_CREATED',
         'USER',
         id
       FROM created_user
       RETURNING id
     )
     SELECT created_user.*
     FROM created_user
     JOIN audit_entry ON TRUE`,
    [
      input.name,
      input.email,
      passwordHash,
      input.role,
      actorId,
    ],
  );

  const user = result.rows[0];

  if (!user) {
    throw new Error('User creation returned no record.');
  }

  return user;
}