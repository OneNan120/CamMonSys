import { z } from 'zod';
import { pool } from './db.js';
import { hashPassword } from './auth/password.js';

const demoUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(12),
  role: z.enum(['ADMIN', 'MONITOR', 'RESPONDER']),
});

async function seed() {
  // Validate every account before writing anything.
  const users = ['ADMIN', 'MONITOR', 'RESPONDER'].map((role) =>
    demoUserSchema.parse({
      name: process.env[`DEMO_${role}_NAME`],
      email: process.env[`DEMO_${role}_EMAIL`],
      password: process.env[`DEMO_${role}_PASSWORD`],
      role,
    }),
  );

  for (const user of users) {
    const passwordHash = await hashPassword(user.password);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [user.name, user.email, passwordHash, user.role],
    );

    console.log(
      `${user.role}: ${result.rowCount === 1 ? 'created' : 'already exists'}`,
    );
  }
}

try {
  await seed();
} catch {
  console.error('Seeding failed. Check demo variables and database setup.');
  process.exitCode = 1;
} finally {
  await pool.end();
}