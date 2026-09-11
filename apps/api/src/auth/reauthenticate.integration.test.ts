import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db.js';
import { hashPassword } from './password.js';

const app = createApp(async () => {
  await pool.query('SELECT 1');
});

const adminId = randomUUID();
const monitorId = randomUUID();
const responderId = randomUUID();

const adminEmail =
  `reauth-admin-${adminId}@example.com`;

const monitorEmail =
  `reauth-monitor-${monitorId}@example.com`;

const responderEmail =
  `reauth-responder-${responderId}@example.com`;

const password = 'reauthentication-test-password';

let verified = false;

beforeAll(async () => {
  const database = await pool.query<{ name: string }>(
    'SELECT current_database() AS name',
  );

  if (database.rows[0]?.name !== 'cammon_test') {
    throw new Error('Integration tests require cammon_test.');
  }

  verified = true;

  const passwordHash = await hashPassword(password);

  await pool.query(
    `INSERT INTO users (
       id,
       name,
       email,
       password_hash,
       role
     )
     VALUES
       (
         $1,
         'Reauthentication Admin',
         $2,
         $3,
         'ADMIN'
       ),
       (
         $4,
         'Reauthentication Monitor',
         $5,
         $3,
         'MONITOR'
       ),
       (
         $6,
         'Reauthentication Responder',
         $7,
         $3,
         'RESPONDER'
       )`,
    [
      adminId,
      adminEmail,
      passwordHash,
      monitorId,
      monitorEmail,
      responderId,
      responderEmail,
    ],
  );
});

afterAll(async () => {
  try {
    if (verified) {
      await pool.query(
        `DELETE FROM auth_sessions
         WHERE user_id IN ($1, $2, $3)`,
        [adminId, monitorId, responderId],
      );

      await pool.query(
        `DELETE FROM users
         WHERE id IN ($1, $2, $3)`,
        [adminId, monitorId, responderId],
      );
    }
  } finally {
    await pool.end();
  }
});

describe('Admin reauthentication', () => {
  it('verifies the current Admin without creating another session', async () => {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: adminEmail,
        password,
      })
      .expect(200);

    const before = await pool.query(
      `SELECT id
       FROM auth_sessions
       WHERE user_id = $1`,
      [adminId],
    );

    expect(before.rowCount).toBe(1);

    const response = await client
      .post('/api/auth/reauthenticate')
      .send({ password })
      .expect(204);

    expect(response.headers['set-cookie']).toBeUndefined();

    const after = await pool.query(
      `SELECT id
       FROM auth_sessions
       WHERE user_id = $1`,
      [adminId],
    );

    expect(after.rowCount).toBe(1);
    expect(after.rows).toEqual(before.rows);

    // The original login session remains usable.
    await client.get('/api/auth/me').expect(200);
  });

  it('rejects an incorrect password without ending the session', async () => {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: adminEmail,
        password,
      })
      .expect(200);

    const response = await client
      .post('/api/auth/reauthenticate')
      .send({
        password: 'incorrect-password',
      })
      .expect(401);

    expect(response.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: 'Incorrect password.',
    });

    await client.get('/api/auth/me').expect(200);
  });

  it('rejects missing, empty, and oversized passwords', async () => {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: adminEmail,
        password,
      })
      .expect(200);

    for (const body of [
      {},
      { password: '' },
      { password: 'x'.repeat(1025) },
    ]) {
      const response = await client
        .post('/api/auth/reauthenticate')
        .send(body)
        .expect(400);

      expect(response.body.error).toMatchObject({
        code: 'INVALID_INPUT',
        message: 'Provide your password.',
      });
    }
  });

  it('rejects unauthenticated requests', async () => {
    await request(app)
      .post('/api/auth/reauthenticate')
      .send({ password })
      .expect(401);
  });

  it('rejects Monitor and Responder users', async () => {
    for (const email of [monitorEmail, responderEmail]) {
      const client = request.agent(app);

      await client
        .post('/api/auth/login')
        .send({
          email,
          password,
        })
        .expect(200);

      const response = await client
        .post('/api/auth/reauthenticate')
        .send({ password })
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });
});