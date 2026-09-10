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
       ($4, 'Test Monitor', $5, $3, 'MONITOR')`,
        [adminId, adminEmail, hash, monitorId, monitorEmail],
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

