import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pool } from '../db.js';
import { updateMonitoringEventStatus, responderHasActiveDeviceAssignment } from './monitoring-event.service.js';
import request from 'supertest';
import { createApp } from '../app.js';
import { hashPassword } from '../auth/password.js';

const adminId = randomUUID();
const monitorId = randomUUID();
const deviceId = randomUUID();
const eventId = randomUUID();
const responderId = randomUUID();
const secondResponderId = randomUUID();
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
      ($3, 'Event Monitor', $4, 'not-a-login-hash', 'MONITOR'),
      ($5, 'Event Responder One', $6, 'not-a-login-hash', 'RESPONDER'),
      ($7, 'Event Responder Two', $8, 'not-a-login-hash', 'RESPONDER')`,
    [
      adminId,
      `event-admin-${adminId}@example.com`,
      monitorId,
      `event-monitor-${monitorId}@example.com`,
      responderId,
      `event-responder-${responderId}@example.com`,
      secondResponderId,
      `event-responder-${secondResponderId}@example.com`,
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
    `UPDATE users
    SET password_hash = $1
    WHERE id IN ($2, $3, $4, $5)`,
    [
      hash,
      adminId,
      monitorId,
      responderId,
      secondResponderId,
    ],
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
        `DELETE FROM auth_sessions
        WHERE user_id IN ($1, $2, $3, $4)`,
        [adminId, monitorId, responderId, secondResponderId],
      );

      await pool.query(
        `DELETE FROM users
        WHERE id IN ($1, $2, $3, $4)`,
        [adminId, monitorId, responderId, secondResponderId],
      );
    }
  } finally {
    await pool.end();
  }
});

it('handles concurrent acknowledgements and preserves event history', async () => {
    await pool.query(
    `UPDATE events
     SET assigned_to_id = $2,
         assigned_by_id = $3,
         instructions = 'Resolve this event.'
     WHERE id = $1`,
    [eventId, responderId, adminId],
  );

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

  expect(resolved).toMatchObject({
    id: eventId,
    device_id: deviceId,
    status: 'RESOLVED',
    assigned_to_id: responderId,
  });

  expect(
    await responderHasActiveDeviceAssignment(
      responderId,
      deviceId,
    ),
  ).toBe(false);

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

it('returns event detail to operators and only the assigned Responder', async () => {
  const detailEventId = randomUUID();
  await pool.query(`INSERT INTO events (id, device_id, type, assigned_to_id, assigned_by_id, instructions) VALUES ($1, $2, 'MOTION', $3, $4, 'Check the room.')`, [detailEventId, deviceId, responderId, adminId]);
  for (const [email, expected] of [[`event-admin-${adminId}@example.com`, 200], [`event-monitor-${monitorId}@example.com`, 200], [`event-responder-${responderId}@example.com`, 200], [`event-responder-${secondResponderId}@example.com`, 404]] as const) {
    const client = request.agent(app);
    await client.post('/api/auth/login').send({ email, password }).expect(200);
    const response = await client.get(`/api/events/${detailEventId}`).expect(expected);
    if (expected === 200) expect(response.body.event).toMatchObject({ id: detailEventId, device_name: 'Event camera', instructions: 'Check the room.' });
  }
  await request(app).get(`/api/events/${detailEventId}`).expect(401);
  const admin = request.agent(app); await admin.post('/api/auth/login').send({ email: `event-admin-${adminId}@example.com`, password }).expect(200);
  await admin.get('/api/events/not-a-uuid').expect(400);
  await admin.get(`/api/events/${randomUUID()}`).expect(404);
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

it('assigns, reassigns, and unassigns an unresolved event', async () => {
  const assignmentEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (id, device_id, type)
     VALUES ($1, $2, 'BED_EXIT')`,
    [assignmentEventId, deviceId],
  );

  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-monitor-${monitorId}@example.com`,
      password,
    })
    .expect(200);

  const assigned = await client
    .patch(`/api/events/${assignmentEventId}/assignment`)
    .send({
      responderId,
      instructions: '  Check the patient and bed alarm.  ',
    })
    .expect(200);

  expect(assigned.body.event).toMatchObject({
    id: assignmentEventId,
    assigned_to_id: responderId,
    assigned_by_id: monitorId,
    instructions: 'Check the patient and bed alarm.',
  });

  const reassigned = await client
    .patch(`/api/events/${assignmentEventId}/assignment`)
    .send({
      responderId: secondResponderId,
      instructions: 'Continue the in-person check.',
    })
    .expect(200);

  expect(reassigned.body.event).toMatchObject({
    assigned_to_id: secondResponderId,
    assigned_by_id: monitorId,
    instructions: 'Continue the in-person check.',
  });

  const unassigned = await client
    .patch(`/api/events/${assignmentEventId}/assignment`)
    .send({ responderId: null })
    .expect(200);

  expect(unassigned.body.event).toMatchObject({
    assigned_to_id: null,
    assigned_by_id: monitorId,
    instructions: null,
  });

  const saved = await pool.query(
    `SELECT assigned_to_id, assigned_by_id, instructions
     FROM events
     WHERE id = $1`,
    [assignmentEventId],
  );

  expect(saved.rows[0]).toEqual({
    assigned_to_id: null,
    assigned_by_id: monitorId,
    instructions: null,
  });

  const auditLogs = await pool.query(
    `SELECT actor_id, action, target_type, target_id
     FROM audit_logs
     WHERE target_type = 'EVENT'
       AND target_id = $1`,
    [assignmentEventId],
  );

  expect(auditLogs.rows).toEqual(
    expect.arrayContaining([
      {
        actor_id: monitorId,
        action: 'EVENT_ASSIGNED',
        target_type: 'EVENT',
        target_id: assignmentEventId,
      },
      {
        actor_id: monitorId,
        action: 'EVENT_REASSIGNED',
        target_type: 'EVENT',
        target_id: assignmentEventId,
      },
      {
        actor_id: monitorId,
        action: 'EVENT_UNASSIGNED',
        target_type: 'EVENT',
        target_id: assignmentEventId,
      },
    ]),
  );

  expect(auditLogs.rows).toHaveLength(3);
});

it('validates assignment targets, event state, and input', async () => {
  const openEventId = randomUUID();
  const resolvedEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (id, device_id, type, status)
     VALUES
       ($1, $3, 'TEST_ALERT', 'OPEN'),
       ($2, $3, 'TEST_ALERT', 'RESOLVED')`,
    [openEventId, resolvedEventId, deviceId],
  );

  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-admin-${adminId}@example.com`,
      password,
    })
    .expect(200);

  await client
    .patch(`/api/events/${openEventId}/assignment`)
    .send({
      responderId: monitorId,
      instructions: 'Wrong role',
    })
    .expect(404);

  await client
    .patch(`/api/events/${openEventId}/assignment`)
    .send({
      responderId: randomUUID(),
      instructions: 'Missing responder',
    })
    .expect(404);

  await client
    .patch(`/api/events/${resolvedEventId}/assignment`)
    .send({
      responderId,
      instructions: 'Resolved event',
    })
    .expect(409);

  await client
    .patch(`/api/events/${randomUUID()}/assignment`)
    .send({
      responderId,
      instructions: 'Missing event',
    })
    .expect(404);

  await client
    .patch(`/api/events/${openEventId}/assignment`)
    .send({
      responderId,
      instructions: '   ',
    })
    .expect(400);

  await client
    .patch(`/api/events/${openEventId}/assignment`)
    .send({ responderId })
    .expect(400);

  await client
    .patch('/api/events/not-a-uuid/assignment')
    .send({
      responderId,
      instructions: 'Invalid event ID',
    })
    .expect(400);

  await request(app)
    .patch(`/api/events/${openEventId}/assignment`)
    .send({
      responderId,
      instructions: 'Unauthenticated',
    })
    .expect(401);
});

it('returns only the authenticated Responder active assignments', async () => {
  const assignedOpenEventId = randomUUID();
  const assignedAcknowledgedEventId = randomUUID();
  const assignedResolvedEventId = randomUUID();
  const otherResponderEventId = randomUUID();
  const unassignedEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (
       id,
       device_id,
       type,
       status,
       assigned_to_id,
       assigned_by_id,
       instructions
     )
     VALUES
       (
         $1,
         $6,
         'TEST_ALERT',
         'OPEN',
         $7,
         $8,
         'Check the camera and visit the room.'
       ),
       (
         $2,
         $6,
         'MOTION',
         'ACKNOWLEDGED',
         $7,
         $8,
         'Confirm that the area is safe.'
       ),
       (
         $3,
         $6,
         'BED_EXIT',
         'RESOLVED',
         $7,
         $8,
         'This assignment is already complete.'
       ),
       (
         $4,
         $6,
         'TEST_ALERT',
         'OPEN',
         $9,
         $8,
         'Assigned to another responder.'
       ),
       (
         $5,
         $6,
         'MOTION',
         'OPEN',
         NULL,
         NULL,
         NULL
       )`,
    [
      assignedOpenEventId,
      assignedAcknowledgedEventId,
      assignedResolvedEventId,
      otherResponderEventId,
      unassignedEventId,
      deviceId,
      responderId,
      monitorId,
      secondResponderId,
    ],
  );

  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-responder-${responderId}@example.com`,
      password,
    })
    .expect(200);

  const response = await client
    .get('/api/events?assignedTo=me')
    .expect(200);

  const returnedIds = response.body.events.map(
    (event: { id: string }) => event.id,
  );

  expect(returnedIds).toEqual(
    expect.arrayContaining([
      assignedOpenEventId,
      assignedAcknowledgedEventId,
    ]),
  );

  expect(returnedIds).not.toContain(assignedResolvedEventId);
  expect(returnedIds).not.toContain(otherResponderEventId);
  expect(returnedIds).not.toContain(unassignedEventId);

  expect(response.body.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: assignedOpenEventId,
        device_id: deviceId,
        device_name: 'Event camera',
        device_location: 'Test room',
        status: 'OPEN',
        assigned_to_id: responderId,
        assigned_to_name: 'Event Responder One',
        assigned_by_name: 'Event Monitor',
        instructions: 'Check the camera and visit the room.',
      }),
      expect.objectContaining({
        id: assignedAcknowledgedEventId,
        status: 'ACKNOWLEDGED',
        assigned_to_id: responderId,
        instructions: 'Confirm that the area is safe.',
      }),
    ]),
  );
});

it('prevents Responders from using unrestricted event queries', async () => {
  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-responder-${responderId}@example.com`,
      password,
    })
    .expect(200);

  const unrestricted = await client
    .get('/api/events')
    .expect(403);

  expect(unrestricted.body.error).toMatchObject({
    code: 'FORBIDDEN',
    message: 'Responders may only view their active assignments.',
  });

  const deviceFiltered = await client
    .get(
      `/api/events?assignedTo=me&deviceId=${encodeURIComponent(deviceId)}`,
    )
    .expect(403);

  expect(deviceFiltered.body.error).toMatchObject({
    code: 'FORBIDDEN',
    message: 'Responders may only view their active assignments.',
  });
});

it('keeps unrestricted event listing available to Admin and Monitor users', async () => {
  const roles = [
    {
      email: `event-admin-${adminId}@example.com`,
    },
    {
      email: `event-monitor-${monitorId}@example.com`,
    },
  ];

  for (const role of roles) {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: role.email,
        password,
      })
      .expect(200);

    const response = await client
      .get(`/api/events?deviceId=${encodeURIComponent(deviceId)}`)
      .expect(200);

    expect(Array.isArray(response.body.events)).toBe(true);

    expect(response.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          device_id: deviceId,
        }),
      ]),
    );
  }
});

it('rejects assignedTo=me for Admin and Monitor users', async () => {
  const roles = [
    `event-admin-${adminId}@example.com`,
    `event-monitor-${monitorId}@example.com`,
  ];

  for (const email of roles) {
    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email, password })
      .expect(200);

    const response = await client
      .get('/api/events?assignedTo=me')
      .expect(400);

    expect(response.body.error).toMatchObject({
      code: 'INVALID_INPUT',
      message:
        'The assignedTo filter is only available to Responders.',
    });
  }
});

it('lets an assigned Responder acknowledge and resolve with a completion note', async () => {
  const responderEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (
       id,
       device_id,
       type,
       status,
       assigned_to_id,
       assigned_by_id,
       instructions
     )
     VALUES (
       $1,
       $2,
       'BED_EXIT',
       'OPEN',
       $3,
       $4,
       'Check the patient and resolve the alarm.'
     )`,
    [
      responderEventId,
      deviceId,
      responderId,
      monitorId,
    ],
  );

  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-responder-${responderId}@example.com`,
      password,
    })
    .expect(200);

  const acknowledged = await client
    .patch(`/api/events/${responderEventId}/status`)
    .send({
      status: 'ACKNOWLEDGED',
    })
    .expect(200);

  expect(acknowledged.body.event).toMatchObject({
    id: responderEventId,
    status: 'ACKNOWLEDGED',
    assigned_to_id: responderId,
    completion_note: null,
  });

  const resolved = await client
    .patch(`/api/events/${responderEventId}/status`)
    .send({
      status: 'RESOLVED',
    })
    .expect(200);


  expect(resolved.body.event).toMatchObject({
    id: responderEventId,
    status: 'RESOLVED',
    assigned_to_id: responderId,
    completion_note: null,
  });

  const saved = await pool.query(
    `SELECT
       status,
       acknowledged_by_id,
       acknowledged_at,
       resolved_by_id,
       resolved_at,
       completion_note
     FROM events
     WHERE id = $1`,
    [responderEventId],
  );

  expect(saved.rows[0]).toMatchObject({
    status: 'RESOLVED',
    acknowledged_by_id: responderId,
    resolved_by_id: responderId,
    completion_note: null,
  });

  expect(saved.rows[0].acknowledged_at).toBeInstanceOf(Date);
  expect(saved.rows[0].resolved_at).toBeInstanceOf(Date);

  const audit = await pool.query(
    `SELECT actor_id, action, target_type, target_id
     FROM audit_logs
     WHERE target_type = 'EVENT'
       AND target_id = $1
     ORDER BY created_at`,
    [responderEventId],
  );

  expect(audit.rows).toEqual([
    {
      actor_id: responderId,
      action: 'EVENT_ACKNOWLEDGED',
      target_type: 'EVENT',
      target_id: responderEventId,
    },
    {
      actor_id: responderId,
      action: 'EVENT_RESOLVED',
      target_type: 'EVENT',
      target_id: responderEventId,
    },
  ]);
});

it('prevents a Responder from updating another Responders event', async () => {
  const otherEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (
       id,
       device_id,
       type,
       status,
       assigned_to_id,
       assigned_by_id,
       instructions
     )
     VALUES (
       $1,
       $2,
       'MOTION',
       'OPEN',
       $3,
       $4,
       'Assigned to another Responder.'
     )`,
    [
      otherEventId,
      deviceId,
      secondResponderId,
      monitorId,
    ],
  );

  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-responder-${responderId}@example.com`,
      password,
    })
    .expect(200);

  const response = await client
    .patch(`/api/events/${otherEventId}/status`)
    .send({
      status: 'ACKNOWLEDGED',
    })
    .expect(403);

  expect(response.body.error).toMatchObject({
    code: 'FORBIDDEN',
    message: 'This event is not assigned to you.',
  });

  const saved = await pool.query(
    `SELECT status, acknowledged_by_id
     FROM events
     WHERE id = $1`,
    [otherEventId],
  );

  expect(saved.rows[0]).toEqual({
    status: 'OPEN',
    acknowledged_by_id: null,
  });
});

it('prevents an assigned Responder from skipping directly to Resolved', async () => {
  const openEventId = randomUUID();

  await pool.query(
    `INSERT INTO events (
       id,
       device_id,
       type,
       status,
       assigned_to_id,
       assigned_by_id,
       instructions
     )
     VALUES (
       $1,
       $2,
       'TEST_ALERT',
       'OPEN',
       $3,
       $4,
       'Acknowledge before resolving.'
     )`,
    [
      openEventId,
      deviceId,
      responderId,
      adminId,
    ],
  );

  const client = request.agent(app);

  await client
    .post('/api/auth/login')
    .send({
      email: `event-responder-${responderId}@example.com`,
      password,
    })
    .expect(200);

  const response = await client
    .patch(`/api/events/${openEventId}/status`)
    .send({
      status: 'RESOLVED',
      completionNote: 'Attempted to skip acknowledgement.',
    })
    .expect(409);

  expect(response.body.error.code).toBe(
    'EVENT_STATUS_CONFLICT',
  );
});