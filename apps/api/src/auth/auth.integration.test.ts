import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db.js';
import { hashPassword } from './password.js';

const app = createApp(async () => {
  await pool.query('SELECT 1');
});

const userId = randomUUID();
const email = `auth-test-${userId}@example.com`;
const password = 'example-test-password';

let testDatabaseVerified = false;

beforeAll(async () => {
  // Verify the actual database before writing test data.
  const result = await pool.query<{ name: string }>(
    'SELECT current_database() AS name',
  );

  if (result.rows[0]?.name !== 'cammon_test') {
    throw new Error('Integration tests require cammon_test.');
  }

  testDatabaseVerified = true;

  const hash = await hashPassword(password);

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, 'Authentication Test', email, hash, 'MONITOR'],
  );
});

afterAll(async () => {
  try {
    if (testDatabaseVerified) {
        await pool.query(
        'DELETE FROM auth_sessions WHERE user_id = $1',
        [userId],
        );

        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    }
  } finally {
    await pool.end();
  }
});

describe('authentication flow', () => {
  it('logs in, identifies the user, and revokes the old cookie', async () => {
    const client = request.agent(app);

    const login = await client
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    expect(login.body.user.id).toBe(userId);
    expect(login.body.user).not.toHaveProperty('password_hash');

    const header = login.headers['set-cookie'];
    const cookies = Array.isArray(header) ? header : [header];
    const oldCookie = cookies
      .find((value) => value?.startsWith('cammon_token='))
      ?.split(';')[0];

    if (!oldCookie) {
      throw new Error('Login did not set the authentication cookie.');
    }

    const me = await client.get('/api/auth/me').expect(200);
    expect(me.body.user.id).toBe(userId);

    await client.post('/api/auth/logout').expect(204);

    // Cookie jar should no longer authenticate.
    await client.get('/api/auth/me').expect(401);

    // Even explicitly reusing the old cookie must fail.
    await request(app)
      .get('/api/auth/me')
      .set('Cookie', oldCookie)
      .expect(401);
  });

  it('rejects an incorrect password', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'incorrect-password' })
      .expect(401);
  });

  it('rejects invalid input', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'invalid-email', password })
      .expect(400);
  });

  it('rejects requests without a cookie', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });
});