import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { pool } from '../db.js';
import { reservePublishingSession, renewPublishingSession, getActivePublishingSession } from './publishing.service.js';
import { getDeviceById } from './device.service.js';
import { revokeLoginSession } from '../auth/session.service.js';
import { createMonitoringEvent } from '../monitoring/monitoring-event.service.js';
import { processResponderRevocations } from '../video/responder-revocation.service.js';

const { disconnect } = vi.hoisted(() => ({ disconnect: vi.fn(async () => {}) }));
vi.mock('../video/livekit.service.js', () => ({ disconnectResponderFromCamera: disconnect }));
const user = randomUUID(), responder = randomUUID(), session = randomUUID(), device = randomUUID();
let verified = false;
beforeAll(async () => {
  const db = await pool.query('SELECT current_database() AS name');
  if (db.rows[0].name !== 'cammon_test') throw new Error('Test database required.');
  verified = true;
  await pool.query(
    `INSERT INTO users(id,name,email,password_hash,role) VALUES
     ($1,'Lifecycle Admin',$2,'unused','ADMIN'),($3,'Lifecycle Responder',$4,'unused','RESPONDER')`,
    [user, user+'@test.invalid', responder, responder+'@test.invalid'],
  );
  await pool.query("INSERT INTO auth_sessions(id,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 hour')", [session,user]);
  await pool.query("INSERT INTO devices(id,name,location,created_by_id) VALUES($1,'Lifecycle','Test',$2)", [device,user]);
});
beforeEach(async () => {
  disconnect.mockReset().mockResolvedValue(undefined);
  await pool.query('DELETE FROM events WHERE device_id=$1', [device]);
  await pool.query('DELETE FROM camera_responder_revocations WHERE device_id=$1', [device]);
  await pool.query('DELETE FROM camera_room_cleanup WHERE device_id=$1', [device]);
  await pool.query("UPDATE auth_sessions SET revoked_at=NULL,expires_at=NOW()+INTERVAL '1 hour' WHERE id=$1", [session]);
  await pool.query('UPDATE devices SET deleted_at=NULL,publishing_session_id=NULL,publishing_owner_session_id=NULL,publishing_started_at=NULL,last_seen_at=NOW() WHERE id=$1', [device]);
});
afterAll(async () => {
  try {
    if (verified) {
      await pool.query('DELETE FROM events WHERE device_id=$1', [device]);
      await pool.query('DELETE FROM camera_room_cleanup WHERE device_id=$1', [device]);
      await pool.query('DELETE FROM devices WHERE id=$1', [device]);
      await pool.query('DELETE FROM auth_sessions WHERE id=$1', [session]);
      await pool.query('DELETE FROM users WHERE id IN ($1,$2)', [user,responder]);
    }
  } finally { await pool.end(); }
});

it('keeps previous Last Seen but waits for this publication heartbeat', async () => {
  const before = await getDeviceById(device);
  const run = await reservePublishingSession(device,session);
  expect(run).not.toBeNull();
  expect((await getDeviceById(device)).last_seen_at).toEqual(before.last_seen_at);
  expect((await getDeviceById(device)).status).toBe('OFFLINE');
  expect(await getActivePublishingSession(device)).toBeNull();
  await renewPublishingSession(device,run!.publishing_session_id,session);
  expect((await getDeviceById(device)).status).toBe('ONLINE');
  expect(await getActivePublishingSession(device)).not.toBeNull();
  await pool.query("UPDATE devices SET publishing_lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[device]);
  expect((await getDeviceById(device)).status).toBe('OFFLINE');
  expect(await getActivePublishingSession(device)).toBeNull();
});

it('logout clears publication and queues room cleanup atomically', async () => {
  const run = await reservePublishingSession(device,session);
  await revokeLoginSession(session);
  expect((await getDeviceById(device)).stream_version).toBeNull();
  const queued = await pool.query('SELECT * FROM camera_room_cleanup WHERE device_id=$1',[device]);
  expect(queued.rows[0].publishing_session_id).toBe(run!.publishing_session_id);
  expect(await reservePublishingSession(device,session)).toBeNull();
});

it('does not insert an alert after a concurrent soft deletion', async () => {
  const run = await reservePublishingSession(device,session);
  const client = await pool.connect();
  let pending: ReturnType<typeof createMonitoringEvent> | undefined;
  try {
    await client.query('BEGIN');
    await client.query('UPDATE devices SET deleted_at=NOW() WHERE id=$1',[device]);
    pending = createMonitoringEvent(device,run!.publishing_session_id,session,'TEST_ALERT');
    await client.query('COMMIT');
    expect(await pending).toBeNull();
  } finally { await client.query('ROLLBACK'); client.release(); }
});

it('persists failed Responder revocation and retries it', async () => {
  await reservePublishingSession(device,session);
  const result = await pool.query(
    "INSERT INTO events(device_id,type,assigned_to_id) VALUES($1,'TEST_ALERT',$2) RETURNING id",
    [device,responder],
  );
  await pool.query("UPDATE events SET status='RESOLVED' WHERE id=$1",[result.rows[0].id]);
  disconnect.mockRejectedValueOnce(new Error('Video service unavailable'));
  await processResponderRevocations();
  expect((await pool.query('SELECT id FROM camera_responder_revocations WHERE device_id=$1',[device])).rowCount).toBe(1);
  await processResponderRevocations();
  expect(disconnect).toHaveBeenCalledTimes(2);
  expect((await pool.query('SELECT id FROM camera_responder_revocations WHERE device_id=$1',[device])).rowCount).toBe(0);
});
