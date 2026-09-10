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
const adminEmail = `group-admin-${adminId}@example.com`;
const monitorEmail = `group-monitor-${monitorId}@example.com`;
const password = 'device-group-test-password';
const groupPrefix = `group-test-${randomUUID()}`;

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
       ($1, 'Group Admin', $2, $3, 'ADMIN'),
       ($4, 'Group Monitor', $5, $3, 'MONITOR')`,
        [
            adminId,
            adminEmail,
            passwordHash,
            monitorId,
            monitorEmail,
        ],
    );
});

afterAll(async () => {
    try {
        if (testDatabaseVerified) {
            await pool.query(
                `DELETE FROM audit_logs
                WHERE actor_id IN ($1, $2)
                AND target_type = 'DEVICE_GROUP'`,
                [adminId, monitorId],
            );

            await pool.query(
            'DELETE FROM devices WHERE name LIKE $1',
            [`${groupPrefix}-device-%`],
            );

            await pool.query(
                'DELETE FROM device_groups WHERE name LIKE $1',
                [`${groupPrefix}-%`],
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

describe('device groups', () => {
    it('lets an Admin create groups and lists them alphabetically', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        const zuluName = `${groupPrefix}-Zulu`;
        const alphaName = `${groupPrefix}-Alpha`;

        const zulu = await client
            .post('/api/device-groups')
            .send({ name: zuluName })
            .expect(201);

        expect(zulu.body.group).toMatchObject({
            name: zuluName,
        });

        const creationAudit = await pool.query(
            `SELECT actor_id, action, target_type, target_id
            FROM audit_logs
            WHERE target_type = 'DEVICE_GROUP'
                AND target_id = $1`,
            [zulu.body.group.id],
            );

            expect(creationAudit.rows).toEqual([
            {
                actor_id: adminId,
                action: 'DEVICE_GROUP_CREATED',
                target_type: 'DEVICE_GROUP',
                target_id: zulu.body.group.id,
            },
        ]);

        const alpha = await client
            .post('/api/device-groups')
            .send({ name: `  ${alphaName}  ` })
            .expect(201);

        expect(alpha.body.group).toMatchObject({
            name: alphaName,
        });

        const response = await client
            .get('/api/device-groups')
            .expect(200);

        const names = response.body.groups.map(
            (group: { name: string }) => group.name,
        );

        expect(names.indexOf(alphaName)).toBeGreaterThanOrEqual(0);
        expect(names.indexOf(zuluName)).toBeGreaterThanOrEqual(0);
        expect(names.indexOf(alphaName)).toBeLessThan(
            names.indexOf(zuluName),
        );
    });

    it('returns 409 for a duplicate group name', async () => {
        const client = request.agent(app);
        const name = `${groupPrefix}-Duplicate`;

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        await client
            .post('/api/device-groups')
            .send({ name })
            .expect(201);

        const response = await client
            .post('/api/device-groups')
            .send({ name })
            .expect(409);

        expect(response.body.error.code).toBe(
            'DEVICE_GROUP_NAME_CONFLICT',
        );
    });

    it('rejects invalid group names', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        await client
            .post('/api/device-groups')
            .send({ name: '   ' })
            .expect(400);

        await client
            .post('/api/device-groups')
            .send({ name: 'x'.repeat(101) })
            .expect(400);
    });

    it('lets a Monitor list groups but not create them', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        await client.get('/api/device-groups').expect(200);

        await client
            .post('/api/device-groups')
            .send({ name: `${groupPrefix}-Forbidden` })
            .expect(403);
    });

    it('rejects unauthenticated group requests', async () => {
        await request(app).get('/api/device-groups').expect(401);

        await request(app)
            .post('/api/device-groups')
            .send({ name: `${groupPrefix}-Unauthenticated` })
            .expect(401);
    });

    it('deletes a group while preserving its devices as ungrouped', async () => {
        const client = request.agent(app);

        await client
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        const created = await client
            .post('/api/device-groups')
            .send({ name: `${groupPrefix}-Deletable` })
            .expect(201);

        const groupId = created.body.group.id as string;
        const deviceId = randomUUID();

        await pool.query(
            `INSERT INTO devices (
            id,
            name,
            location,
            created_by_id,
            group_id
            )
            VALUES ($1, $2, 'Group deletion room', $3, $4)`,
            [
            deviceId,
            `${groupPrefix}-device-preserved`,
            adminId,
            groupId,
            ],
        );

        await client
            .delete(`/api/device-groups/${groupId}`)
            .expect(204);

        const deletedGroup = await pool.query(
            'SELECT id FROM device_groups WHERE id = $1',
            [groupId],
        );

        expect(deletedGroup.rowCount).toBe(0);

        const preservedDevice = await pool.query(
            `SELECT id, group_id
            FROM devices
            WHERE id = $1`,
            [deviceId],
        );

        expect(preservedDevice.rows[0]).toEqual({
            id: deviceId,
            group_id: null,
        });

        const deletionAudit = await pool.query(
            `SELECT actor_id, action, target_type, target_id
            FROM audit_logs
            WHERE target_type = 'DEVICE_GROUP'
            AND target_id = $1
            AND action = 'DEVICE_GROUP_DELETED'`,
            [groupId],
        );

        expect(deletionAudit.rows).toEqual([
            {
            actor_id: adminId,
            action: 'DEVICE_GROUP_DELETED',
            target_type: 'DEVICE_GROUP',
            target_id: groupId,
            },
        ]);
        });

        it('validates deletion and enforces Admin permission', async () => {
        const groupId = randomUUID();

        await pool.query(
            `INSERT INTO device_groups (id, name)
            VALUES ($1, $2)`,
            [groupId, `${groupPrefix}-Protected`],
        );

        const monitor = request.agent(app);

        await monitor
            .post('/api/auth/login')
            .send({ email: monitorEmail, password })
            .expect(200);

        await monitor
            .delete(`/api/device-groups/${groupId}`)
            .expect(403);

        await request(app)
            .delete(`/api/device-groups/${groupId}`)
            .expect(401);

        const admin = request.agent(app);

        await admin
            .post('/api/auth/login')
            .send({ email: adminEmail, password })
            .expect(200);

        await admin
            .delete('/api/device-groups/not-a-uuid')
            .expect(400);

        await admin
            .delete(`/api/device-groups/${randomUUID()}`)
            .expect(404);

        const preservedGroup = await pool.query(
            'SELECT id FROM device_groups WHERE id = $1',
            [groupId],
        );

        expect(preservedGroup.rowCount).toBe(1);
        });
});