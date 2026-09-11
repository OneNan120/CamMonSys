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
const secondTargetId = randomUUID();
const thirdTargetId = randomUUID();
const fourthTargetId = randomUUID();

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
      target_id,
      created_at
    )
    VALUES
      (
        $1,
        'TEST_AUDIT_ACTION',
        'TEST_TARGET',
        $4,
        '2026-01-01T10:00:00.000Z'
      ),
      (
        $2,
        'TEST_EVENT_RESOLVED',
        'EVENT',
        $5,
        '2026-01-02T10:00:00.000Z'
      ),
      (
        $1,
        'TEST_EVENT_ASSIGNED',
        'EVENT',
        $6,
        '2026-01-03T10:00:00.000Z'
      ),
      (
        $3,
        'TEST_DEVICE_VIEWED',
        'DEVICE',
        $7,
        '2026-01-04T10:00:00.000Z'
      )`,
    [
      adminId,
      monitorId,
      responderId,
      targetId,
      secondTargetId,
      thirdTargetId,
      fourthTargetId,
    ],
  );
});

async function createAdminClient() {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({ email: adminEmail, password })
    .expect(200);

  return client;
}

afterAll(async () => {
  try {
    if (verified) {
      await pool.query(
        `DELETE FROM audit_logs
        WHERE target_id IN ($1, $2, $3, $4)`,
        [
          targetId,
          secondTargetId,
          thirdTargetId,
          fourthTargetId,
        ],
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
    await client.get('/api/audit-logs/filter-options').expect(403);
  }
});

it('validates the audit-log', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({ email: adminEmail, password })
    .expect(200);

  await client.get('/api/audit-logs?limit=0').expect(400);
  await client.get('/api/audit-logs?limit=201').expect(400);
  await client.get('/api/audit-logs?limit=invalid').expect(400);
  await client.get('/api/audit-logs?actorId=not-a-uuid').expect(400);

  await client.get('/api/audit-logs?sort=invalid').expect(400);

  await client.get('/api/audit-logs?from=not-a-date').expect(400);

  await client
  .get(
      '/api/audit-logs' +
        '?from=2026-01-03T00%3A00%3A00.000Z' +
        '&to=2026-01-02T00%3A00%3A00.000Z',
    )
    .expect(400);
});

it('requires authentication', async () => {
  await request(app).get('/api/audit-logs').expect(401);
});

it('searches audit records by actor, action, and target ID', async () => {
  const client = await createAdminClient();

  const actorSearch = await client
    .get('/api/audit-logs?search=Audit%20Monitor')
    .expect(200);

  expect(actorSearch.body.auditLogs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target_id: secondTargetId,
        actor_name: 'Audit Monitor',
      }),
    ]),
  );

  const actionSearch = await client
    .get('/api/audit-logs?search=event_assigned')
    .expect(200);

  expect(actionSearch.body.auditLogs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target_id: thirdTargetId,
        action: 'TEST_EVENT_ASSIGNED',
      }),
    ]),
  );

  const targetSearch = await client
    .get(
      `/api/audit-logs?search=${encodeURIComponent(fourthTargetId)}`,
    )
    .expect(200);

  expect(targetSearch.body.auditLogs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        target_id: fourthTargetId,
      }),
    ]),
  );
});

it('filters audit records by actor and action', async () => {
  const client = await createAdminClient();

  const actorResponse = await client
    .get(
      `/api/audit-logs?actorId=${encodeURIComponent(adminId)}`,
    )
    .expect(200);

  const actorTargetIds = actorResponse.body.auditLogs.map(
    (auditLog: { target_id: string }) => auditLog.target_id,
  );

  expect(actorTargetIds).toContain(targetId);
  expect(actorTargetIds).toContain(thirdTargetId);
  expect(actorTargetIds).not.toContain(secondTargetId);
  expect(actorTargetIds).not.toContain(fourthTargetId);

  const actionResponse = await client
    .get('/api/audit-logs?action=TEST_EVENT_RESOLVED')
    .expect(200);

  expect(actionResponse.body.auditLogs).toEqual([
    expect.objectContaining({
      action: 'TEST_EVENT_RESOLVED',
      target_id: secondTargetId,
    }),
  ]);
});

it('filters audit records by target type', async () => {
  const client = await createAdminClient();

  const response = await client
    .get('/api/audit-logs?targetType=EVENT')
    .expect(200);

  const targetIds = response.body.auditLogs.map(
    (auditLog: { target_id: string }) => auditLog.target_id,
  );

  expect(targetIds).toContain(secondTargetId);
  expect(targetIds).toContain(thirdTargetId);
  expect(targetIds).not.toContain(targetId);
  expect(targetIds).not.toContain(fourthTargetId);
});

it('filters audit records by timestamp range', async () => {
  const client = await createAdminClient();

  const from = encodeURIComponent(
    '2026-01-02T00:00:00.000Z',
  );

  const to = encodeURIComponent(
    '2026-01-02T23:59:59.999Z',
  );

  const response = await client
    .get(`/api/audit-logs?from=${from}&to=${to}`)
    .expect(200);

  const targetIds = response.body.auditLogs.map(
    (auditLog: { target_id: string }) => auditLog.target_id,
  );

  expect(targetIds).toContain(secondTargetId);
  expect(targetIds).not.toContain(targetId);
  expect(targetIds).not.toContain(thirdTargetId);
  expect(targetIds).not.toContain(fourthTargetId);
});

it('filters audit records by timestamp range', async () => {
  const client = await createAdminClient();

  const from = encodeURIComponent(
    '2026-01-02T00:00:00.000Z',
  );

  const to = encodeURIComponent(
    '2026-01-02T23:59:59.999Z',
  );

  const response = await client
    .get(`/api/audit-logs?from=${from}&to=${to}`)
    .expect(200);

  const targetIds = response.body.auditLogs.map(
    (auditLog: { target_id: string }) => auditLog.target_id,
  );

  expect(targetIds).toContain(secondTargetId);
  expect(targetIds).not.toContain(targetId);
  expect(targetIds).not.toContain(thirdTargetId);
  expect(targetIds).not.toContain(fourthTargetId);
});

it('sorts audit records by oldest or newest timestamp', async () => {
  const client = await createAdminClient();

  const oldestFirst = await client
    .get(
      `/api/audit-logs?actorId=${encodeURIComponent(
        adminId,
      )}&sort=oldest`,
    )
    .expect(200);

  expect(
    oldestFirst.body.auditLogs.map(
      (auditLog: { target_id: string }) =>
        auditLog.target_id,
    ),
  ).toEqual([targetId, thirdTargetId]);

  const newestFirst = await client
    .get(
      `/api/audit-logs?actorId=${encodeURIComponent(
        adminId,
      )}&sort=newest`,
    )
    .expect(200);

  expect(
    newestFirst.body.auditLogs.map(
      (auditLog: { target_id: string }) =>
        auditLog.target_id,
    ),
  ).toEqual([thirdTargetId, targetId]);
});

it('combines audit filters using AND semantics', async () => {
  const client = await createAdminClient();

  const response = await client
    .get(
      `/api/audit-logs?actorId=${encodeURIComponent(
        adminId,
      )}&targetType=EVENT&sort=oldest`,
    )
    .expect(200);

  expect(response.body.auditLogs).toEqual([
    expect.objectContaining({
      target_id: thirdTargetId,
      actor_id: adminId,
      target_type: 'EVENT',
    }),
  ]);
});

it('returns available audit filter options', async () => {
  const client = await createAdminClient();

  const response = await client
    .get('/api/audit-logs/filter-options')
    .expect(200);

  expect(response.body.actors).toEqual(
    expect.arrayContaining([
      {
        id: adminId,
        name: 'Audit Admin',
      },
      {
        id: monitorId,
        name: 'Audit Monitor',
      },
      {
        id: responderId,
        name: 'Audit Responder',
      },
    ]),
  );

  expect(response.body.actions).toEqual(
    expect.arrayContaining([
      'TEST_AUDIT_ACTION',
      'TEST_EVENT_RESOLVED',
      'TEST_EVENT_ASSIGNED',
      'TEST_DEVICE_VIEWED',
    ]),
  );

  expect(response.body.targetTypes).toEqual(
    expect.arrayContaining([
      'TEST_TARGET',
      'EVENT',
      'DEVICE',
    ]),
  );
});

