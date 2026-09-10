import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { pool } from '../db.js';
import { hashPassword } from '../auth/password.js';

const app = createApp(async () => {
  await pool.query('SELECT 1');
});

const adminId = randomUUID();
const monitorId = randomUUID();
const alphaResponderId = randomUUID();
const zuluResponderId = randomUUID();

const adminEmail = `responder-admin-${adminId}@example.com`;
const monitorEmail = `responder-monitor-${monitorId}@example.com`;
const alphaResponderEmail =
  `responder-alpha-${alphaResponderId}@example.com`;
const password = 'responder-directory-test-password';
const namePrefix = `Responder Test ${randomUUID()}`;

let testDatabaseVerified = false;

beforeAll(async () => {
  const database = await pool.query<{ name: string }>(
    'SELECT current_database() AS name',
  );

  if (database.rows[0]?.name !== 'cammon_test') {
    throw new Error('Integration tests require cammon_test.');
  }

  testDatabaseVerified = true;

  const passwordHash = await hashPassword(password);

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES
       ($1, 'Directory Admin', $2, $3, 'ADMIN'),
       ($4, 'Directory Monitor', $5, $3, 'MONITOR'),
       ($6, $7, $8, $3, 'RESPONDER'),
       ($9, $10, $11, $3, 'RESPONDER')`,
    [
      adminId,
      adminEmail,
      passwordHash,
      monitorId,
      monitorEmail,
      alphaResponderId,
      `${namePrefix} Alpha`,
      alphaResponderEmail,
      zuluResponderId,
      `${namePrefix} Zulu`,
      `responder-zulu-${zuluResponderId}@example.com`,
    ],
  );
});

afterAll(async () => {
  try {
    if (testDatabaseVerified) {
      await pool.query(
        `DELETE FROM auth_sessions
         WHERE user_id IN ($1, $2, $3, $4)`,
        [
          adminId,
          monitorId,
          alphaResponderId,
          zuluResponderId,
        ],
      );

      await pool.query(
        `DELETE FROM users
         WHERE id IN ($1, $2, $3, $4)`,
        [
          adminId,
          monitorId,
          alphaResponderId,
          zuluResponderId,
        ],
      );
    }
  } finally {
    await pool.end();
  }
});

describe('responder directory', () => {
  it('returns only responder IDs and names in alphabetical order', async () => {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    const response = await client
      .get('/api/responders')
      .expect(200);

    const alphaIndex = response.body.responders.findIndex(
      (responder: { id: string }) =>
        responder.id === alphaResponderId,
    );

    const zuluIndex = response.body.responders.findIndex(
      (responder: { id: string }) =>
        responder.id === zuluResponderId,
    );

    expect(alphaIndex).toBeGreaterThanOrEqual(0);
    expect(zuluIndex).toBeGreaterThanOrEqual(0);
    expect(alphaIndex).toBeLessThan(zuluIndex);

    const alpha = response.body.responders[alphaIndex];

    expect(alpha).toEqual({
      id: alphaResponderId,
      name: `${namePrefix} Alpha`,
    });

    expect(Object.keys(alpha).sort()).toEqual(['id', 'name']);
  });

  it('allows a Monitor to list responders', async () => {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email: monitorEmail, password })
      .expect(200);

    await client.get('/api/responders').expect(200);
  });

  it('rejects Responder and unauthenticated requests', async () => {
    const responder = request.agent(app);

    await responder
      .post('/api/auth/login')
      .send({
        email: alphaResponderEmail,
        password,
      })
      .expect(200);

    await responder.get('/api/responders').expect(403);
    await request(app).get('/api/responders').expect(401);
  });
});