import { pool } from '../db.js';
import { verifyPassword } from './password.js';

type UserRow = {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: 'ADMIN' | 'MONITOR' | 'RESPONDER';
};

export async function authenticateUser(
  email: string,
  password: string,
) {
  const result = await pool.query<UserRow>(
    `SELECT id, name, email, password_hash, role
     FROM users
     WHERE email = $1`,
    [email.trim().toLowerCase()],
  );

  const user = result.rows[0];

  if (!user) {
    return null;
  }

  const matches = await verifyPassword(user.password_hash, password);

  if (!matches) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}