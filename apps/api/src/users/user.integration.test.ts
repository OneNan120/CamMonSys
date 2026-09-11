import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';

import { createApp } from '../app.js';
import { pool } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';

const app = createApp(async () => {
  await pool.query('SELECT 1');
});

const adminId = randomUUID();
const monitorId = randomUUID();

const adminEmail = `users-admin-${adminId}@example.com`;
const monitorEmail = `users-monitor-${monitorId}@example.com`;

const password = 'users-integration-password';
const createdIds: string[] = [];

let verified = false;

beforeAll(async () => {
  const db = await pool.query<{ name: string }>(
    'SELECT current_database() AS name',
  );

  if (db.rows[0]?.name !== 'cammon_test') {
    throw new Error('Integration tests require cammon_test.');
  }

  verified = true;

  const hash = await hashPassword(password);

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES
       ($1, 'Users Admin', $2, $3, 'ADMIN'),
       ($4, 'Users Monitor', $5, $3, 'MONITOR')`,
    [adminId, adminEmail, hash, monitorId, monitorEmail],
  );
});

afterAll(async () => {
  try {
    if (verified) {
      await pool.query(
        `DELETE FROM audit_logs
         WHERE target_type = 'USER'
           AND target_id = ANY($1::uuid[])`,
        [createdIds],
      );

      await pool.query(
        `DELETE FROM auth_sessions
         WHERE user_id = $1
            OR user_id = ANY($2::uuid[])`,
        [adminId, createdIds],
      );

      await pool.query(
        `DELETE FROM users
         WHERE id = $1
            OR id = $2
            OR id = ANY($3::uuid[])`,
        [adminId, monitorId, createdIds],
      );
    }
  } finally {
    await pool.end();
  }
});

async function login(email = adminEmail) {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);

  return client;
}

it('lets Admin list public user fields', async () => {
  const client = await login();

  const response = await client.get('/api/users').expect(200);

  expect(response.body.users).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: adminId,
        email: adminEmail,
        role: 'ADMIN',
      }),
    ]),
  );

  expect(JSON.stringify(response.body)).not.toContain('password_hash');
});

it('creates every role transactionally and permits login', async () => {
  const client = await login();

  for (const role of ['ADMIN', 'MONITOR', 'RESPONDER'] as const) {
    const email = `created-${role.toLowerCase()}-${randomUUID()}@EXAMPLE.COM`;

    const response = await client
      .post('/api/users')
      .send({
        name: `Created ${role}`,
        email,
        password: 'created-user-password',
        role,
      })
      .expect(201);

    createdIds.push(response.body.user.id);

    expect(response.body.user).toMatchObject({
      name: `Created ${role}`,
      email: email.toLowerCase(),
      role,
    });

    expect(response.body.user).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('password_hash');

    const saved = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [response.body.user.id],
    );

    expect(saved.rows[0]?.password_hash).not.toBe('created-user-password');

    expect(
      await verifyPassword(
        saved.rows[0]!.password_hash,
        'created-user-password',
      ),
    ).toBe(true);

    const audit = await pool.query(
      `SELECT actor_id, action, target_type
       FROM audit_logs
       WHERE target_id = $1`,
      [response.body.user.id],
    );

    expect(audit.rows[0]).toMatchObject({
      actor_id: adminId,
      action: 'USER_CREATED',
      target_type: 'USER',
    });
  }

  const createdLogin = request.agent(app);

  await createdLogin
    .post('/api/auth/login')
    .send({
      email: (
        await pool.query<{ email: string }>(
          'SELECT email FROM users WHERE id = $1',
          [createdIds[1]],
        )
      ).rows[0]!.email,
      password: 'created-user-password',
    })
    .expect(200);
});

it('validates input, conflicts, authentication, and role', async () => {
  const admin = await login();

  await admin
    .post('/api/users')
    .send({
      name: 'Duplicate',
      email: adminEmail,
      password: 'long-enough-password',
      role: 'MONITOR',
    })
    .expect(409);

  for (const body of [
    {
      name: '',
      email: 'valid@example.com',
      password: 'long-enough-password',
      role: 'MONITOR',
    },
    {
      name: 'Name',
      email: 'bad',
      password: 'long-enough-password',
      role: 'MONITOR',
    },
    {
      name: 'Name',
      email: 'valid@example.com',
      password: 'short',
      role: 'MONITOR',
    },
    {
      name: 'Name',
      email: 'valid@example.com',
      password: 'long-enough-password',
      role: 'INVALID',
    },
  ]) {
    await admin.post('/api/users').send(body).expect(400);
  }

  await request(app).get('/api/users').expect(401);

  await request(app)
    .post('/api/users')
    .send({
      name: 'Name',
      email: 'valid@example.com',
      password: 'long-enough-password',
      role: 'MONITOR',
    })
    .expect(401);

  const monitor = await login(monitorEmail);

  await monitor.get('/api/users').expect(403);

  await monitor
    .post('/api/users')
    .send({
      name: 'Name',
      email: 'valid@example.com',
      password: 'long-enough-password',
      role: 'MONITOR',
    })
    .expect(403);
});