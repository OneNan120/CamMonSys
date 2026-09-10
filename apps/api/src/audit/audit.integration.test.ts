import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';
import { pool } from '../db.js';

const app = createApp(async () => {
  await pool.query('SELECT 1');
});

const adminId = randomUUID();
const monitorId = randomUUID();
const responderId = randomUUID();
const targetId = randomUUID();

const adminEmail = `audit-admin-${adminId}@example.com`;
const monitorEmail = `audit-monitor-${monitorId}@example.com`;
const responderEmail = `audit-responder-${responderId}@example.com`;
const password = 'audit-integration-test-password';

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
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES
       ($1, 'Audit Admin', $2, $3, 'ADMIN'),
       ($4, 'Audit Monitor', $5, $3, 'MONITOR'),
       ($6, 'Audit Responder', $7, $3, 'RESPONDER')`,
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

  await pool.query(
    `INSERT INTO audit_logs (
       actor_id,
       action,
       target_type,
       target_id
     )
     VALUES (
       $1,
       'TEST_AUDIT_ACTION',
       'TEST_TARGET',
       $2
     )`,
    [adminId, targetId],
  );
});

afterAll(async () => {
  try {
    if (verified) {
      await pool.query(
        `DELETE FROM audit_logs
         WHERE target_type = 'TEST_TARGET'
           AND target_id = $1`,
        [targetId],
      );

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

it('lets an Admin list audit records', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({ email: adminEmail, password })
    .expect(200);

  const response = await client
    .get('/api/audit-logs?limit=20')
    .expect(200);

  expect(response.body.auditLogs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        action: 'TEST_AUDIT_ACTION',
        target_type: 'TEST_TARGET',
        target_id: targetId,
        actor_id: adminId,
        actor_name: 'Audit Admin',
      }),
    ]),
  );
});

it('rejects Monitor and Responder users', async () => {
  for (const email of [monitorEmail, responderEmail]) {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    await client.get('/api/audit-logs').expect(403);
  }
});

it('validates the audit-log limit', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({ email: adminEmail, password })
    .expect(200);

  await client.get('/api/audit-logs?limit=0').expect(400);
  await client.get('/api/audit-logs?limit=201').expect(400);
  await client.get('/api/audit-logs?limit=invalid').expect(400);
});

it('requires authentication', async () => {
  await request(app).get('/api/audit-logs').expect(401);
});