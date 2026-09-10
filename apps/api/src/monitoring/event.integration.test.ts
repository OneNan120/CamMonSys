import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool } from '../db.js';
import { updateMonitoringEventStatus } from './monitoring-event.service.js';
import request from 'supertest';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';

const adminId = randomUUID();
const monitorId = randomUUID();
const deviceId = randomUUID();
const eventId = randomUUID();
const app = createApp(async () => {
  await pool.query('SELECT 1');
});

const password = 'event-integration-test-password';

let verified = false;

beforeAll(async () => {
  const database = await pool.query<{ name: string }>(
    'SELECT current_database() AS name',
  );

  if (database.rows[0]?.name !== 'cammon_test') {
    throw new Error('Integration tests require cammon_test.');
  }

  verified = true;

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role)
     VALUES
       ($1, 'Event Admin', $2, 'not-a-login-hash', 'ADMIN'),
       ($3, 'Event Monitor', $4, 'not-a-login-hash', 'MONITOR')`,
    [
      adminId,
      `event-admin-${adminId}@example.com`,
      monitorId,
      `event-monitor-${monitorId}@example.com`,
    ],
  );

  await pool.query(
    `INSERT INTO devices (id, name, location, created_by_id)
     VALUES ($1, 'Event camera', 'Test room', $2)`,
    [deviceId, adminId],
  );

  await pool.query(
    `INSERT INTO events (id, device_id, type)
     VALUES ($1, $2, 'TEST_ALERT')`,
    [eventId, deviceId],
  );
  const hash = await hashPassword(password);

  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id IN ($2, $3)',
    [hash, adminId, monitorId],
  );
});

afterAll(async () => {
  try {
    if (verified) {
      await pool.query(
        `DELETE FROM audit_logs
        WHERE target_type = 'EVENT'
          AND target_id IN (
            SELECT id
            FROM events
            WHERE device_id = $1
          )`,
        [deviceId],
      );
      await pool.query(
        'DELETE FROM events WHERE device_id = $1',
        [deviceId],
      );

      await pool.query(
        'DELETE FROM camera_room_cleanup WHERE device_id = $1',
        [deviceId],
      );

      await pool.query(
        'DELETE FROM devices WHERE id = $1',
        [deviceId],
      );

      await pool.query(
        'DELETE FROM auth_sessions WHERE user_id IN ($1, $2)',
        [adminId, monitorId],
      );

      await pool.query(
        'DELETE FROM users WHERE id IN ($1, $2)',
        [adminId, monitorId],
      );
    }
  } finally {
    await pool.end();
  }
});

it('handles concurrent acknowledgements and preserves event history', async () => {
  // Open events cannot skip directly to Resolved.
  expect(
    await updateMonitoringEventStatus(eventId, 'RESOLVED', adminId),
  ).toBeNull();

  const results = await Promise.all([
    updateMonitoringEventStatus(eventId, 'ACKNOWLEDGED', adminId),
    updateMonitoringEventStatus(eventId, 'ACKNOWLEDGED', monitorId),
  ]);

  expect(results.filter((result) => result !== null)).toHaveLength(1);
  expect(results.filter((result) => result === null)).toHaveLength(1);

  const acknowledged = await pool.query(
    `SELECT status, acknowledged_by_id, acknowledged_at
     FROM events WHERE id = $1`,
    [eventId],
  );

  const savedAcknowledgement = acknowledged.rows[0];

  expect(savedAcknowledgement.status).toBe('ACKNOWLEDGED');
  expect([adminId, monitorId]).toContain(
    savedAcknowledgement.acknowledged_by_id,
  );
  expect(savedAcknowledgement.acknowledged_at).toBeInstanceOf(Date);

  const resolved = await updateMonitoringEventStatus(
    eventId,
    'RESOLVED',
    adminId,
  );

  expect(resolved?.status).toBe('RESOLVED');

  const auditLogs = await pool.query(
    `SELECT actor_id, action, target_type, target_id
    FROM audit_logs
    WHERE target_type = 'EVENT'
      AND target_id = $1`,
    [eventId],
  );

  expect(auditLogs.rows).toHaveLength(2);

  expect(auditLogs.rows).toEqual(
    expect.arrayContaining([
      {
        actor_id: savedAcknowledgement.acknowledged_by_id,
        action: 'EVENT_ACKNOWLEDGED',
        target_type: 'EVENT',
        target_id: eventId,
      },
      {
        actor_id: adminId,
        action: 'EVENT_RESOLVED',
        target_type: 'EVENT',
        target_id: eventId,
      },
    ]),
  );

  const saved = await pool.query(
    `SELECT status,
            acknowledged_by_id, acknowledged_at,
            resolved_by_id, resolved_at
     FROM events WHERE id = $1`,
    [eventId],
  );

  expect(saved.rows[0].status).toBe('RESOLVED');
  expect(saved.rows[0].acknowledged_by_id).toBe(
    savedAcknowledgement.acknowledged_by_id,
  );
  expect(saved.rows[0].acknowledged_at).toEqual(
    savedAcknowledgement.acknowledged_at,
  );
  expect(saved.rows[0].resolved_by_id).toBe(adminId);
  expect(saved.rows[0].resolved_at).toBeInstanceOf(Date);

  // Resolved events cannot be acknowledged again.
  expect(
    await updateMonitoringEventStatus(eventId, 'ACKNOWLEDGED', monitorId),
  ).toBeNull();
});

it('requires authentication for event APIs', async () => {
  await request(app)
    .get('/api/events')
    .expect(401);

  await request(app)
    .post(`/api/devices/${deviceId}/events`)
    .send({
      publishingSessionId: randomUUID(),
      type: 'TEST_ALERT',
    })
    .expect(401);

  await request(app)
    .patch(`/api/events/${eventId}/status`)
    .send({ status: 'ACKNOWLEDGED' })
    .expect(401);
});

it('lets Monitor read and acknowledge events but not create camera alerts', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-monitor-${monitorId}@example.com`,
      password,
    })
    .expect(200);

  // A separate event keeps this test independent of the earlier test.
  const openEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (id, device_id, type)
     VALUES ($1, $2, 'TEST_ALERT')`,
    [openEventId, deviceId],
  );

  await client
    .post(`/api/devices/${deviceId}/events`)
    .send({
      publishingSessionId: randomUUID(),
      type: 'TEST_ALERT',
    })
    .expect(403);

  await client
    .patch(`/api/events/${openEventId}/status`)
    .send({ status: 'ACKNOWLEDGED' })
    .expect(200);

  await client
    .patch(`/api/events/${openEventId}/status`)
    .send({ status: 'ACKNOWLEDGED' })
    .expect(409);

  const response = await client
    .get(`/api/events?deviceId=${deviceId}`)
    .expect(200);

  expect(response.body.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: openEventId,
        status: 'ACKNOWLEDGED',
        acknowledged_by_name: 'Event Monitor',
      }),
    ]),
  );
});

it('creates an alert from the current publication and rejects stale sessions', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-admin-${adminId}@example.com`,
      password,
    })
    .expect(200);

  const sessions = await pool.query<{ id: string }>(
    `SELECT id
     FROM auth_sessions
     WHERE user_id = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [adminId],
  );

  const ownerSessionId = sessions.rows[0]?.id;

  if (!ownerSessionId) {
    throw new Error('Expected an active Admin login session.');
  }

  const publishingSessionId = randomUUID();

  // Set up a publication without connecting to LiveKit.
  await pool.query(
    `UPDATE devices
     SET publishing_session_id = $2,
         publishing_owner_session_id = $3,
         publishing_lease_expires_at = NOW() + INTERVAL '1 hour',
         last_seen_at = NOW()
     WHERE id = $1`,
    [deviceId, publishingSessionId, ownerSessionId],
  );

  const created = await client
    .post(`/api/devices/${deviceId}/events`)
    .send({
      publishingSessionId,
      type: 'TEST_ALERT',
    })
    .expect(201);

  expect(created.body.event).toMatchObject({
    device_id: deviceId,
    type: 'TEST_ALERT',
    status: 'OPEN',
  });

  const saved = await pool.query(
    'SELECT device_id, type, status FROM events WHERE id = $1',
    [created.body.event.id],
  );

  expect(saved.rows[0]).toEqual({
    device_id: deviceId,
    type: 'TEST_ALERT',
    status: 'OPEN',
  });

  const before = await pool.query(
    'SELECT id FROM events WHERE device_id = $1',
    [deviceId],
  );

  // An old browser tab sends a different publishing-session ID.
  await client
    .post(`/api/devices/${deviceId}/events`)
    .send({
      publishingSessionId: randomUUID(),
      type: 'TEST_ALERT',
    })
    .expect(409);

  // Even the correct ID must fail once its lease has expired.
  await pool.query(
    `UPDATE devices
     SET publishing_lease_expires_at = NOW() - INTERVAL '1 minute'
     WHERE id = $1`,
    [deviceId],
  );

  await client
    .post(`/api/devices/${deviceId}/events`)
    .send({
      publishingSessionId,
      type: 'TEST_ALERT',
    })
    .expect(409);

  const after = await pool.query(
    'SELECT id FROM events WHERE device_id = $1',
    [deviceId],
  );

  expect(after.rowCount).toBe(before.rowCount);
});

it('rejects invalid status input and returns 404 for missing events', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-monitor-${monitorId}@example.com`,
      password,
    })
    .expect(200);

  await client
    .patch('/api/events/not-a-uuid/status')
    .send({ status: 'ACKNOWLEDGED' })
    .expect(400);

  await client
    .patch(`/api/events/${eventId}/status`)
    .send({ status: 'OPEN' })
    .expect(400);

  await client
    .patch(`/api/events/${eventId}/status`)
    .send({})
    .expect(400);

  await client
    .patch(`/api/events/${randomUUID()}/status`)
    .send({ status: 'ACKNOWLEDGED' })
    .expect(404);

  await client
    .get('/api/events?deviceId=not-a-uuid')
    .expect(400);
});