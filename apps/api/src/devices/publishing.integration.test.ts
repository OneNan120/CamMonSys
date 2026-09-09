import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { pool } from '../db.js';
import {reservePublishingSession, releasePublishingSession, renewPublishingSession, expirePublishingSessions, } from './publishing.service.js';

const userId = randomUUID();
const loginSessionId = randomUUID();
const deviceId = randomUUID();
let verified = false;

beforeAll(async () => {
    const database = await pool.query<{ name: string }>(
        'SELECT current_database() AS name',
    );

    if (database.rows[0]?.name !== 'cammon_test') {
        throw new Error('Integration tests require cammon_test.');
    }

    verified = true;

    // This test never logs in, so no usable password is needed.
    await pool.query(
        `INSERT INTO users (id, name, email, password_hash, role)
     VALUES ($1, 'Publishing Test', $2, 'not-a-login-hash', 'ADMIN')`,
        [userId, `publishing-${userId}@example.com`],
    );

    await pool.query(
        `INSERT INTO auth_sessions (id, user_id, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
        [loginSessionId, userId],
    );

    await pool.query(
        `INSERT INTO devices (id, name, location, created_by_id)
     VALUES ($1, 'Test camera', 'Test room', $2)`,
        [deviceId, userId],
    );
});

afterAll(async () => {
    try {
        if (verified) {
            await pool.query('DELETE FROM camera_room_cleanup WHERE device_id = $1', [deviceId],);
            await pool.query('DELETE FROM devices WHERE id = $1', [deviceId]);
            await pool.query('DELETE FROM auth_sessions WHERE id = $1', [loginSessionId,]);
            await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        }
    } finally {
        await pool.end();
    }
});

describe('publishing reservation', () => {
    it('allows only one concurrent reservation and rejects stale releases', async () => {
        const reservations = await Promise.all([
            reservePublishingSession(deviceId, loginSessionId),
            reservePublishingSession(deviceId, loginSessionId),
        ]);

        const successful = reservations.filter(
            (reservation) => reservation !== null,
        );

        expect(successful).toHaveLength(1);

        const reservation = successful[0];

        if (!reservation) {
            throw new Error('Expected one successful reservation.');
        }

        // An unrelated publishing ID must not clear the reservation.
        expect(
            await releasePublishingSession(
                deviceId,
                randomUUID(),
                loginSessionId,
            ),
        ).toBe(false);

        expect(
            await reservePublishingSession(deviceId, loginSessionId),
        ).toBeNull();

        expect(
            await releasePublishingSession(
                deviceId,
                reservation.publishing_session_id,
                loginSessionId,
            ),
        ).toBe(true);

        const replacement = await reservePublishingSession(
            deviceId,
            loginSessionId,
        );

        expect(replacement).not.toBeNull();

        // The original publisher cannot release the replacement.
        expect(
            await releasePublishingSession(
                deviceId,
                reservation.publishing_session_id,
                loginSessionId,
            ),
        ).toBe(false);
    });

    it('replaces an expired reservation and preserves its ID for cleanup', async () => {
        const oldPublishingSessionId = randomUUID();

        await pool.query(
            `UPDATE devices
            SET publishing_session_id = $2,
                publishing_owner_session_id = $3,
                publishing_lease_expires_at =
                NOW() - INTERVAL '1 minute',
                last_seen_at = NOW() - INTERVAL '2 minutes'
            WHERE id = $1`,
            [deviceId, oldPublishingSessionId, loginSessionId],
        );

        const before = await pool.query(
            'SELECT last_seen_at FROM devices WHERE id = $1',
            [deviceId],
        );

        const replacement = await reservePublishingSession(
            deviceId,
            loginSessionId,
        );

        const pending = await pool.query(
            `SELECT id FROM camera_room_cleanup
            WHERE device_id = $1
                AND publishing_session_id = $2`,
            [deviceId, oldPublishingSessionId],
        );

        expect(pending.rowCount).toBe(1);

        expect(replacement).not.toBeNull();

        if (!replacement) {
            throw new Error('Expected the expired reservation to be replaced.');
        }

        expect(replacement.previousPublishingSessionId).toBe(
            oldPublishingSessionId,
        );

        expect(replacement.publishing_session_id).not.toBe(
            oldPublishingSessionId,
        );

        const after = await pool.query(
            `SELECT publishing_session_id, last_seen_at
        FROM devices
        WHERE id = $1`,
            [deviceId],
        );

        expect(after.rows[0].publishing_session_id).toBe(
            replacement.publishing_session_id,
        );

        expect(after.rows[0].last_seen_at).toEqual(
            before.rows[0].last_seen_at,
        );
    });

    it('renews the current publishing session and updates Last Seen', async () => {
  const publishingSessionId = randomUUID();

  await pool.query(
    `UPDATE devices
     SET publishing_session_id = $2,
         publishing_owner_session_id = $3,
         publishing_lease_expires_at = NOW() + INTERVAL '5 seconds',
         last_seen_at = NULL
     WHERE id = $1`,
    [deviceId, publishingSessionId, loginSessionId],
  );

  const renewed = await renewPublishingSession(
    deviceId,
    publishingSessionId,
    loginSessionId,
  );

  expect(renewed).not.toBeNull();

  if (!renewed) {
    throw new Error('Expected the current session to renew.');
  }

  expect(renewed.last_seen_at).toBeInstanceOf(Date);
  expect(renewed.publishing_lease_expires_at.getTime()).toBeGreaterThan(
    renewed.last_seen_at.getTime(),
  );
    });

    it('rejects a stale publishing ID or a different owner', async () => {
    const publishingSessionId = randomUUID();

    await pool.query(
        `UPDATE devices
        SET publishing_session_id = $2,
            publishing_owner_session_id = $3,
            publishing_lease_expires_at = NOW() + INTERVAL '1 minute',
            last_seen_at = NULL
        WHERE id = $1`,
        [deviceId, publishingSessionId, loginSessionId],
    );

    expect(
        await renewPublishingSession(deviceId, randomUUID(), loginSessionId),
    ).toBeNull();

    expect(
        await renewPublishingSession(deviceId, publishingSessionId, randomUUID()),
    ).toBeNull();

    const saved = await pool.query(
        'SELECT last_seen_at FROM devices WHERE id = $1',
        [deviceId],
    );

    expect(saved.rows[0].last_seen_at).toBeNull();
    });

    it('does not revive an expired publishing session', async () => {
    const publishingSessionId = randomUUID();

    await pool.query(
        `UPDATE devices
        SET publishing_session_id = $2,
            publishing_owner_session_id = $3,
            publishing_lease_expires_at = NOW() - INTERVAL '1 minute',
            last_seen_at = NULL
        WHERE id = $1`,
        [deviceId, publishingSessionId, loginSessionId],
    );

    expect(
        await renewPublishingSession(
        deviceId,
        publishingSessionId,
        loginSessionId,
        ),
    ).toBeNull();

    const saved = await pool.query(
        'SELECT last_seen_at FROM devices WHERE id = $1',
        [deviceId],
    );

    expect(saved.rows[0].last_seen_at).toBeNull();
    });

    it('releases a session and queues its room for cleanup', async () => {
        const publishingSessionId = randomUUID();

        await pool.query(
            `UPDATE devices
            SET publishing_session_id = $2,
                publishing_owner_session_id = $3,
                publishing_lease_expires_at = NOW() + INTERVAL '1 minute',
                last_seen_at = NOW()
            WHERE id = $1`,
            [deviceId, publishingSessionId, loginSessionId],
        );

        const before = await pool.query(
            'SELECT last_seen_at FROM devices WHERE id = $1',
            [deviceId],
        );

        const released = await releasePublishingSession(
            deviceId,
            publishingSessionId,
            loginSessionId,
        );

        expect(released).toBe(true);

        const after = await pool.query(
            `SELECT publishing_session_id,
                    publishing_owner_session_id,
                    publishing_lease_expires_at,
                    last_seen_at
            FROM devices
            WHERE id = $1`,
            [deviceId],
        );

        expect(after.rows[0]).toEqual({
            publishing_session_id: null,
            publishing_owner_session_id: null,
            publishing_lease_expires_at: null,
            last_seen_at: before.rows[0].last_seen_at,
        });

        const pending = await pool.query(
            `SELECT id FROM camera_room_cleanup
            WHERE device_id = $1
            AND publishing_session_id = $2`,
            [deviceId, publishingSessionId],
        );

        expect(pending.rowCount).toBe(1);

        // Repeating Stop must not create another cleanup record.
        expect(
            await releasePublishingSession(
            deviceId,
            publishingSessionId,
            loginSessionId,
            ),
        ).toBe(false);

        const repeated = await pool.query(
            `SELECT id FROM camera_room_cleanup
            WHERE device_id = $1
            AND publishing_session_id = $2`,
            [deviceId, publishingSessionId],
        );

        expect(repeated.rowCount).toBe(1);
    });

    it('expires abandoned reservations but preserves active ones', async () => {
    const activeDeviceId = randomUUID();
    const expiredSessionId = randomUUID();
    const activeSessionId = randomUUID();

    try {
        // Use the existing test device as the expired device.
        await pool.query(
        `UPDATE devices
        SET publishing_session_id = $2,
            publishing_owner_session_id = $3,
            publishing_lease_expires_at = NOW() - INTERVAL '1 minute',
            last_seen_at = NOW() - INTERVAL '2 minutes'
        WHERE id = $1`,
        [deviceId, expiredSessionId, loginSessionId],
        );

        await pool.query(
        `INSERT INTO devices (
            id, name, location, created_by_id,
            publishing_session_id,
            publishing_owner_session_id,
            publishing_lease_expires_at
        )
        VALUES (
            $1, 'Active camera', 'Test room', $2,
            $3, $4, NOW() + INTERVAL '1 hour'
        )`,
        [activeDeviceId, userId, activeSessionId, loginSessionId],
        );

        const before = await pool.query(
        'SELECT last_seen_at FROM devices WHERE id = $1',
        [deviceId],
        );

        await expirePublishingSessions();

        const expired = await pool.query(
        `SELECT publishing_session_id,
                publishing_owner_session_id,
                publishing_lease_expires_at,
                last_seen_at
        FROM devices
        WHERE id = $1`,
        [deviceId],
        );

        expect(expired.rows[0]).toEqual({
        publishing_session_id: null,
        publishing_owner_session_id: null,
        publishing_lease_expires_at: null,
        last_seen_at: before.rows[0].last_seen_at,
        });

        const pending = await pool.query(
        `SELECT id FROM camera_room_cleanup
        WHERE device_id = $1 AND publishing_session_id = $2`,
        [deviceId, expiredSessionId],
        );

        expect(pending.rowCount).toBe(1);

        const active = await pool.query(
        'SELECT publishing_session_id FROM devices WHERE id = $1',
        [activeDeviceId],
        );

        expect(active.rows[0].publishing_session_id).toBe(activeSessionId);

        const activeCleanup = await pool.query(
        'SELECT id FROM camera_room_cleanup WHERE device_id = $1',
        [activeDeviceId],
        );

        expect(activeCleanup.rowCount).toBe(0);
    } finally {
        // The existing afterAll handles deviceId.
        // This extra device needs its own cleanup.
        await pool.query(
        'DELETE FROM camera_room_cleanup WHERE device_id = $1',
        [activeDeviceId],
        );

        await pool.query(
        'DELETE FROM devices WHERE id = $1',
        [activeDeviceId],
        );
    }
    });
});