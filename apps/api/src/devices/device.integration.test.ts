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
const adminEmail = `device-admin-${adminId}@example.com`;
const monitorEmail = `device-monitor-${monitorId}@example.com`;
const password = 'example-test-password';
const deviceGroupPrefix = `device-assignment-test-${randomUUID()}`;
const responderId = randomUUID();
const secondResponderId = randomUUID();
const responderEmail = `device-responder-${responderId}@example.com`;
const secondResponderEmail = `device-responder-${secondResponderId}@example.com`;

let testDatabaseVerified = false;

beforeAll(async () => {
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
    VALUES
      ($1, 'Test Admin', $2, $3, 'ADMIN'),
      ($4, 'Test Monitor', $5, $3, 'MONITOR'),
      ($6, 'Test Responder', $7, $3, 'RESPONDER'),
      ($8, 'Second Test Responder', $9, $3, 'RESPONDER')`,
    [
      adminId,
      adminEmail,
      hash,
      monitorId,
      monitorEmail,
      responderId,
      responderEmail,
      secondResponderId,
      secondResponderEmail,
    ],
  );
});

afterAll(async () => {
    try {
        if (testDatabaseVerified) {
            await pool.query(
                `DELETE FROM audit_logs
                WHERE actor_id IN ($1, $2)
                    OR (
                    target_type = 'DEVICE'
                    AND target_id IN (
                        SELECT id
                        FROM devices
                        WHERE created_by_id IN ($1, $2)
                    )
                    )
                    OR (
                    target_type = 'EVENT'
                    AND target_id IN (
                        SELECT e.id
                        FROM events AS e
                        JOIN devices AS d ON d.id = e.device_id
                        WHERE d.created_by_id IN ($1, $2)
                    )
                    )`,
                [adminId, monitorId],
            );

            await pool.query(
                `DELETE FROM events
                WHERE device_id IN (
                SELECT id
                FROM devices
                WHERE created_by_id IN ($1, $2)
                )`,
                [adminId, monitorId],
            );

            await pool.query(
                `DELETE FROM camera_room_cleanup
                WHERE device_id IN (
                SELECT id
                FROM devices
                WHERE created_by_id IN ($1, $2)
                )`,
                [adminId, monitorId],
            );

            await pool.query(
                'DELETE FROM devices WHERE created_by_id IN ($1, $2)',
                [adminId, monitorId],
            );

            await pool.query(
                'DELETE FROM device_groups WHERE name LIKE $1',
                [`${deviceGroupPrefix}-%`],
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

describe('device registration', () => {
    it('creates an ungrouped device owned by the authenticated Admin', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        const response = await client
            .post('/api/devices')
            .send({
                name: 'Camera 101',
                location: 'Room 101',
                createdById: monitorId,
            })
            .expect(201);

        expect(response.body.device.created_by_id).toBe(adminId);
        expect(response.body.device.group_id).toBeNull();

        const saved = await pool.query(
            'SELECT name, location FROM devices WHERE id = $1',
            [response.body.device.id],
        );

        expect(saved.rows[0]).toEqual({
            name: 'Camera 101',
            location: 'Room 101',
        });
    });

    it('rejects invalid input without creating a device', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        const before = await pool.query(
            'SELECT id FROM devices WHERE created_by_id = $1',
            [adminId],
        );

        await client
            .post('/api/devices')
            .send({ name: '   ', location: 'Room 101' })
            .expect(400);

        const after = await pool.query(
            'SELECT id FROM devices WHERE created_by_id = $1',
            [adminId],
        );

        expect(after.rowCount).toBe(before.rowCount);
    });

    it('rejects a Monitor User', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        await client
            .post('/api/devices')
            .send({ name: 'Camera 102', location: 'Room 102' })
            .expect(403);
    });

    it('rejects an unauthenticated request', async () => {
        await request(app)
            .post('/api/devices')
            .send({ name: 'Camera 103', location: 'Room 103' })
            .expect(401);
    });

    it('lets a Monitor list active devices and excludes deleted devices', async () => {
        const activeId = randomUUID();
        const deletedId = randomUUID();

        await pool.query(
            `INSERT INTO devices
        (id, name, location, created_by_id, deleted_at)
        VALUES
        ($1, 'Active camera', 'Room A', $3, NULL),
        ($2, 'Deleted camera', 'Room B', $3, NOW())`,
            [activeId, deletedId, adminId],
        );

        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        const response = await client.get('/api/devices').expect(200);

        expect(response.body.devices).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: activeId,
                    group_id: null,
                    last_seen_at: null,
                    status: 'OFFLINE',
                }),
            ]),
        );

        const ids = response.body.devices.map(
            (device: { id: string }) => device.id,
        );

        expect(ids).not.toContain(deletedId);
    });

    it('rejects unauthenticated device listing', async () => {
        await request(app).get('/api/devices').expect(401);
    });

    it('allows a Monitor to retrieve an active device', async () => {
        const deviceId = randomUUID();

        await pool.query(
            `INSERT INTO devices (id, name, location, created_by_id)
     VALUES ($1, 'Detail camera', 'Room A', $2)`,
            [deviceId, adminId],
        );

        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        const response = await client
            .get(`/api/devices/${deviceId}`)
            .expect(200);

        expect(response.body.device).toMatchObject({
            id: deviceId,
            name: 'Detail camera',
            location: 'Room A',
            status: 'OFFLINE',
            last_seen_at: null,
        });

        expect(response.body.device).not.toHaveProperty(
            'publishing_session_id',
        );
    });

    it('returns 404 for missing and soft-deleted devices', async () => {
        const deletedId = randomUUID();

        await pool.query(
            `INSERT INTO devices
       (id, name, location, created_by_id, deleted_at)
     VALUES ($1, 'Deleted camera', 'Room B', $2, NOW())`,
            [deletedId, adminId],
        );

        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        await client.get(`/api/devices/${randomUUID()}`).expect(404);
        await client.get(`/api/devices/${deletedId}`).expect(404);
    });

    it('rejects malformed device IDs', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        await client.get('/api/devices/not-a-uuid').expect(400);
    });

    it('requires authentication to retrieve a device', async () => {
        await request(app)
            .get(`/api/devices/${randomUUID()}`)
            .expect(401);
    });

    it('creates a device in the selected group', async () => {
        const groupId = randomUUID();

        await pool.query(
            `INSERT INTO device_groups (id, name)
            VALUES ($1, $2)`,
            [groupId, `${deviceGroupPrefix}-Registration`],
        );

        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        const response = await client
            .post('/api/devices')
            .send({
            name: 'Grouped registration camera',
            location: 'Grouped registration room',
            groupId,
            })
            .expect(201);

        expect(response.body.device).toMatchObject({
            name: 'Grouped registration camera',
            location: 'Grouped registration room',
            created_by_id: adminId,
            group_id: groupId,
        });

        const saved = await pool.query(
            `SELECT group_id
            FROM devices
            WHERE id = $1`,
            [response.body.device.id],
        );

        expect(saved.rows[0].group_id).toBe(groupId);
    });

    it('rejects a missing or malformed registration group', async () => {
        const client = request.agent(app);
        const missingGroupDeviceName =
            `Missing group camera ${randomUUID()}`;

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        const missingGroupResponse = await client
            .post('/api/devices')
            .send({
            name: missingGroupDeviceName,
            location: 'Missing group room',
            groupId: randomUUID(),
            })
            .expect(404);

        expect(missingGroupResponse.body.error.code).toBe(
            'DEVICE_GROUP_NOT_FOUND',
        );

        const accidentallyCreated = await pool.query(
            `SELECT id
            FROM devices
            WHERE name = $1`,
            [missingGroupDeviceName],
        );

        expect(accidentallyCreated.rowCount).toBe(0);

        await client
            .post('/api/devices')
            .send({
            name: 'Malformed group camera',
            location: 'Malformed group room',
            groupId: 'not-a-uuid',
            })
            .expect(400);
    });
});

describe('device deletion', () => {
  it('soft-deletes a device and preserves its resolved event', async () => {
    const deviceId = randomUUID();
    const eventId = randomUUID();
    const publishingSessionId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id,
         publishing_session_id,
         publishing_lease_expires_at
       )
       VALUES (
         $1,
         'Delete camera',
         'Delete room',
         $2,
         $3,
         NOW() + INTERVAL '1 hour'
       )`,
      [deviceId, adminId, publishingSessionId],
    );

    await pool.query(
      `INSERT INTO events (
         id,
         device_id,
         type,
         status,
         acknowledged_by_id,
         acknowledged_at,
         resolved_by_id,
         resolved_at
       )
       VALUES (
         $1,
         $2,
         'TEST_ALERT',
         'RESOLVED',
         $3,
         NOW(),
         $3,
         NOW()
       )`,
      [eventId, deviceId, adminId],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    await client.delete(`/api/devices/${deviceId}`).expect(204);

    const savedDevice = await pool.query(
      `SELECT
         deleted_at,
         publishing_session_id,
         publishing_owner_session_id,
         publishing_lease_expires_at
       FROM devices
       WHERE id = $1`,
      [deviceId],
    );

    expect(savedDevice.rows[0].deleted_at).toBeInstanceOf(Date);
    expect(savedDevice.rows[0].publishing_session_id).toBeNull();
    expect(savedDevice.rows[0].publishing_owner_session_id).toBeNull();
    expect(savedDevice.rows[0].publishing_lease_expires_at).toBeNull();

    const savedEvent = await pool.query(
      'SELECT status FROM events WHERE id = $1',
      [eventId],
    );

    expect(savedEvent.rows[0]).toEqual({
      status: 'RESOLVED',
    });

    const cleanup = await pool.query(
      `SELECT publishing_session_id
       FROM camera_room_cleanup
       WHERE device_id = $1`,
      [deviceId],
    );

    expect(cleanup.rows).toEqual([
      { publishing_session_id: publishingSessionId },
    ]);

    const audit = await pool.query(
      `SELECT actor_id, action, target_type, target_id
       FROM audit_logs
       WHERE target_type = 'DEVICE'
         AND target_id = $1`,
      [deviceId],
    );

    expect(audit.rows).toEqual([
      {
        actor_id: adminId,
        action: 'DEVICE_DELETED',
        target_type: 'DEVICE',
        target_id: deviceId,
      },
    ]);

    await client.get(`/api/devices/${deviceId}`).expect(404);
  });

  it('rejects deletion while the device has an unresolved event', async () => {
    const deviceId = randomUUID();

    await pool.query(
      `INSERT INTO devices (id, name, location, created_by_id)
       VALUES ($1, 'Protected camera', 'Protected room', $2)`,
      [deviceId, adminId],
    );

    await pool.query(
      `INSERT INTO events (device_id, type, status)
       VALUES ($1, 'TEST_ALERT', 'OPEN')`,
      [deviceId],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    const response = await client
      .delete(`/api/devices/${deviceId}`)
      .expect(409);

    expect(response.body.error.code).toBe(
      'DEVICE_HAS_UNRESOLVED_EVENTS',
    );

    const savedDevice = await pool.query(
      'SELECT deleted_at FROM devices WHERE id = $1',
      [deviceId],
    );

    expect(savedDevice.rows[0].deleted_at).toBeNull();
  });

  it('rejects Monitor, unauthenticated, malformed, and missing requests', async () => {
    const deviceId = randomUUID();

    await pool.query(
      `INSERT INTO devices (id, name, location, created_by_id)
       VALUES ($1, 'Authorized camera', 'Authorized room', $2)`,
      [deviceId, adminId],
    );

    const monitor = request.agent(app);

    await monitor
      .post('/api/auth/login')
      .send({ email: monitorEmail, password })
      .expect(200);

    await monitor.delete(`/api/devices/${deviceId}`).expect(403);
    await request(app).delete(`/api/devices/${deviceId}`).expect(401);

    const admin = request.agent(app);

    await admin
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    await admin.delete('/api/devices/not-a-uuid').expect(400);
    await admin.delete(`/api/devices/${randomUUID()}`).expect(404);
  });
});

describe('device group assignment', () => {
  it('lets an Admin assign and remove a device group', async () => {
    const deviceId = randomUUID();
    const groupId = randomUUID();

    await pool.query(
      `INSERT INTO device_groups (id, name)
       VALUES ($1, $2)`,
      [groupId, `${deviceGroupPrefix}-Assignable`],
    );

    await pool.query(
      `INSERT INTO devices (id, name, location, created_by_id)
       VALUES ($1, 'Grouped camera', 'Grouped room', $2)`,
      [deviceId, adminId],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    const assigned = await client
      .patch(`/api/devices/${deviceId}/group`)
      .send({ groupId })
      .expect(200);

    expect(assigned.body.device).toEqual({
      id: deviceId,
      group_id: groupId,
    });

    const savedAssignment = await pool.query(
      'SELECT group_id FROM devices WHERE id = $1',
      [deviceId],
    );

    expect(savedAssignment.rows[0].group_id).toBe(groupId);

    const removed = await client
      .patch(`/api/devices/${deviceId}/group`)
      .send({ groupId: null })
      .expect(200);

    expect(removed.body.device).toEqual({
      id: deviceId,
      group_id: null,
    });

    const savedRemoval = await pool.query(
      'SELECT group_id FROM devices WHERE id = $1',
      [deviceId],
    );

    expect(savedRemoval.rows[0].group_id).toBeNull();

    const auditLogs = await pool.query(
      `SELECT actor_id, action, target_type, target_id
       FROM audit_logs
       WHERE target_type = 'DEVICE'
         AND target_id = $1`,
      [deviceId],
    );

    expect(auditLogs.rows).toEqual(
      expect.arrayContaining([
        {
          actor_id: adminId,
          action: 'DEVICE_GROUP_ASSIGNED',
          target_type: 'DEVICE',
          target_id: deviceId,
        },
        {
          actor_id: adminId,
          action: 'DEVICE_GROUP_REMOVED',
          target_type: 'DEVICE',
          target_id: deviceId,
        },
      ]),
    );

    expect(auditLogs.rows).toHaveLength(2);
  });

  it('rejects a nonexistent group without changing the device', async () => {
    const deviceId = randomUUID();

    await pool.query(
      `INSERT INTO devices (id, name, location, created_by_id)
       VALUES ($1, 'Ungrouped camera', 'Ungrouped room', $2)`,
      [deviceId, adminId],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    const response = await client
      .patch(`/api/devices/${deviceId}/group`)
      .send({ groupId: randomUUID() })
      .expect(404);

    expect(response.body.error.code).toBe(
      'DEVICE_GROUP_NOT_FOUND',
    );

    const saved = await pool.query(
      'SELECT group_id FROM devices WHERE id = $1',
      [deviceId],
    );

    expect(saved.rows[0].group_id).toBeNull();
  });

  it('validates input and enforces Admin permission', async () => {
    const deviceId = randomUUID();

    await pool.query(
      `INSERT INTO devices (id, name, location, created_by_id)
       VALUES ($1, 'Permission camera', 'Permission room', $2)`,
      [deviceId, adminId],
    );

    const admin = request.agent(app);

    await admin
      .post('/api/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    await admin
      .patch(`/api/devices/${deviceId}/group`)
      .send({})
      .expect(400);

    await admin
      .patch(`/api/devices/${deviceId}/group`)
      .send({ groupId: 'not-a-uuid' })
      .expect(400);

    await admin
      .patch('/api/devices/not-a-uuid/group')
      .send({ groupId: null })
      .expect(400);

    await admin
      .patch(`/api/devices/${randomUUID()}/group`)
      .send({ groupId: null })
      .expect(404);

    const monitor = request.agent(app);

    await monitor
      .post('/api/auth/login')
      .send({ email: monitorEmail, password })
      .expect(200);

    await monitor
      .patch(`/api/devices/${deviceId}/group`)
      .send({ groupId: null })
      .expect(403);

    await request(app)
      .patch(`/api/devices/${deviceId}/group`)
      .send({ groupId: null })
      .expect(401);
  });
});

describe('Responder device access', () => {
  it('allows a Responder to retrieve a device with an active assignment', async () => {
    const assignedDeviceId = randomUUID();
    const assignedEventId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id
       )
       VALUES (
         $1,
         'Responder camera',
         'Responder room',
         $2
       )`,
      [assignedDeviceId, adminId],
    );

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
         'Check the room.'
       )`,
      [
        assignedEventId,
        assignedDeviceId,
        responderId,
        monitorId,
      ],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    const response = await client
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(200);

    expect(response.body.device).toMatchObject({
      id: assignedDeviceId,
      name: 'Responder camera',
      location: 'Responder room',
    });
  });

  it('denies a Responder without an assignment for the device', async () => {
    const unassignedDeviceId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id
       )
       VALUES (
         $1,
         'Unassigned camera',
         'Unassigned room',
         $2
       )`,
      [unassignedDeviceId, adminId],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    const response = await client
      .get(`/api/devices/${unassignedDeviceId}`)
      .expect(403);

    expect(response.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message:
        'You do not have an active assignment for this device.',
    });
  });

  it('revokes device access after reassignment', async () => {
    const assignedDeviceId = randomUUID();
    const assignedEventId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id
       )
       VALUES (
         $1,
         'Reassigned camera',
         'Reassigned room',
         $2
       )`,
      [assignedDeviceId, adminId],
    );

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
         'Initial assignment.'
       )`,
      [
        assignedEventId,
        assignedDeviceId,
        responderId,
        monitorId,
      ],
    );

    const firstResponder = request.agent(app);
    const secondResponder = request.agent(app);

    await firstResponder
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    await secondResponder
      .post('/api/auth/login')
      .send({
        email: secondResponderEmail,
        password,
      })
      .expect(200);

    await firstResponder
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(200);

    await pool.query(
      `UPDATE events
       SET assigned_to_id = $2,
           instructions = 'Reassigned.'
       WHERE id = $1`,
      [assignedEventId, secondResponderId],
    );

    await firstResponder
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(403);

    await secondResponder
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(200);
  });

  it('revokes device access after the assignment is resolved', async () => {
    const assignedDeviceId = randomUUID();
    const assignedEventId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id
       )
       VALUES (
         $1,
         'Resolved camera',
         'Resolved room',
         $2
       )`,
      [assignedDeviceId, adminId],
    );

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
         'ACKNOWLEDGED',
         $3,
         $4,
         'Complete the check.'
       )`,
      [
        assignedEventId,
        assignedDeviceId,
        responderId,
        monitorId,
      ],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    await client
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(200);

    await pool.query(
      `UPDATE events
       SET status = 'RESOLVED',
           resolved_by_id = $2,
           resolved_at = NOW()
       WHERE id = $1`,
      [assignedEventId, responderId],
    );

    await client
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(403);
  });

  it('keeps access while another active assignment exists for the device', async () => {
    const assignedDeviceId = randomUUID();
    const resolvedEventId = randomUUID();
    const activeEventId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id
       )
       VALUES (
         $1,
         'Multiple assignment camera',
         'Multiple assignment room',
         $2
       )`,
      [assignedDeviceId, adminId],
    );

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
           $3,
           'TEST_ALERT',
           'RESOLVED',
           $4,
           $5,
           'Completed assignment.'
         ),
         (
           $2,
           $3,
           'MOTION',
           'OPEN',
           $4,
           $5,
           'Still active.'
         )`,
      [
        resolvedEventId,
        activeEventId,
        assignedDeviceId,
        responderId,
        monitorId,
      ],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    await client
      .get(`/api/devices/${assignedDeviceId}`)
      .expect(200);
  });

  it('does not reveal whether an inaccessible device exists', async () => {
    const inaccessibleDeviceId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
         id,
         name,
         location,
         created_by_id
       )
       VALUES (
         $1,
         'Hidden camera',
         'Hidden room',
         $2
       )`,
      [inaccessibleDeviceId, adminId],
    );

    const client = request.agent(app);

    await client
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    await client
      .get(`/api/devices/${inaccessibleDeviceId}`)
      .expect(403);

    await client
      .get(`/api/devices/${randomUUID()}`)
      .expect(403);
  });

  it('grants and revokes Responder view-token access with assignment changes', async () => {
    const viewDeviceId = randomUUID();
    const viewEventId = randomUUID();
    const publishingSessionId = randomUUID();

    await pool.query(
      `INSERT INTO devices (
        id,
        name,
        location,
        created_by_id,
        publishing_session_id,
        publishing_lease_expires_at,
        last_seen_at
      )
      VALUES (
        $1,
        'Responder streaming camera',
        'Streaming room',
        $2,
        $3,
        NOW() + INTERVAL '1 hour',
        NOW()
      )`,
      [
        viewDeviceId,
        adminId,
        publishingSessionId,
      ],
    );

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
        'Watch the camera and check the room.'
      )`,
      [
        viewEventId,
        viewDeviceId,
        responderId,
        monitorId,
      ],
    );

    const firstResponder = request.agent(app);
    const secondResponder = request.agent(app);

    await firstResponder
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    await secondResponder
      .post('/api/auth/login')
      .send({
        email: secondResponderEmail,
        password,
      })
      .expect(200);

    const initialToken = await firstResponder
      .post(`/api/devices/${viewDeviceId}/view-token`)
      .expect(200);

    expect(initialToken.headers['cache-control']).toContain('no-store');

    expect(initialToken.body).toMatchObject({
      serverUrl: expect.any(String),
      token: expect.any(String),
    });

    expect(initialToken.body.token.length).toBeGreaterThan(0);

    const initiallyDenied = await secondResponder
      .post(`/api/devices/${viewDeviceId}/view-token`)
      .expect(403);

    expect(initiallyDenied.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message:
        'You do not have an active assignment for this device.',
    });

    // Reassign the event to the second Responder.
    await pool.query(
      `UPDATE events
      SET assigned_to_id = $2,
          instructions = 'Take over this assignment.'
      WHERE id = $1`,
      [viewEventId, secondResponderId],
    );

    await firstResponder
      .post(`/api/devices/${viewDeviceId}/view-token`)
      .expect(403);

    const reassignedToken = await secondResponder
      .post(`/api/devices/${viewDeviceId}/view-token`)
      .expect(200);

    expect(reassignedToken.body).toMatchObject({
      serverUrl: expect.any(String),
      token: expect.any(String),
    });

    // Resolving the last active assignment removes access.
    await pool.query(
      `UPDATE events
      SET status = 'RESOLVED',
          resolved_by_id = $2,
          resolved_at = NOW()
      WHERE id = $1`,
      [viewEventId, secondResponderId],
    );

    await secondResponder
      .post(`/api/devices/${viewDeviceId}/view-token`)
      .expect(403);
  });

  it('validates and authenticates Responder view-token requests', async () => {
    const responder = request.agent(app);

    await responder
      .post('/api/auth/login')
      .send({
        email: responderEmail,
        password,
      })
      .expect(200);

    await responder
      .post('/api/devices/not-a-uuid/view-token')
      .expect(400);

    await request(app)
      .post(`/api/devices/${randomUUID()}/view-token`)
      .expect(401);
  });
});
