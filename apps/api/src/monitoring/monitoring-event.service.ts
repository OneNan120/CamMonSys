import { pool } from '../db.js';

export type MonitoringEventType = | 'TEST_ALERT' | 'MOTION' | 'BED_EXIT';

type MonitoringEventRow = {
  id: string;
  device_id: string;
  type: MonitoringEventType;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  created_at: Date;
};

export async function createMonitoringEvent(
  deviceId: string,
  publishingSessionId: string,
  ownerSessionId: string,
  type: MonitoringEventType,
) {
  const result = await pool.query<MonitoringEventRow>(
    `INSERT INTO events (device_id, type)
     SELECT id, $4
     FROM devices
     WHERE id = $1
       AND publishing_session_id = $2
       AND publishing_owner_session_id = $3
       AND publishing_lease_expires_at > clock_timestamp()
       AND deleted_at IS NULL
     RETURNING id, device_id, type, status, created_at`,
    [
      deviceId,
      publishingSessionId,
      ownerSessionId,
      type,
    ],
  );

  return result.rows[0] ?? null;
}

export async function listMonitoringEvents(deviceId?: string) {
  const result = await pool.query(
    `SELECT
       e.id,
       e.device_id,
       d.name AS device_name,
       d.location AS device_location,
       e.type,
       e.status,
       e.created_at,
       e.acknowledged_at,
       acknowledged_by.name AS acknowledged_by_name,
       e.resolved_at,
       resolved_by.name AS resolved_by_name
     FROM events AS e
     JOIN devices AS d ON d.id = e.device_id
     LEFT JOIN users AS acknowledged_by
       ON acknowledged_by.id = e.acknowledged_by_id
     LEFT JOIN users AS resolved_by
       ON resolved_by.id = e.resolved_by_id
     WHERE ($1::uuid IS NULL OR e.device_id = $1)
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 100`,
    [deviceId ?? null],
  );

  return result.rows;
}

export async function updateMonitoringEventStatus(
  eventId: string,
  nextStatus: 'ACKNOWLEDGED' | 'RESOLVED',
  actorId: string,
) {
  const expectedStatus =
    nextStatus === 'ACKNOWLEDGED' ? 'OPEN' : 'ACKNOWLEDGED';

  const result = await pool.query<MonitoringEventRow>(
    `UPDATE events
     SET status = $2::event_status,
         acknowledged_by_id = CASE
           WHEN $2::event_status = 'ACKNOWLEDGED' THEN $3::uuid
           ELSE acknowledged_by_id
         END,
         acknowledged_at = CASE
           WHEN $2::event_status = 'ACKNOWLEDGED' THEN NOW()
           ELSE acknowledged_at
         END,
         resolved_by_id = CASE
           WHEN $2::event_status = 'RESOLVED' THEN $3::uuid
           ELSE resolved_by_id
         END,
         resolved_at = CASE
           WHEN $2::event_status = 'RESOLVED' THEN NOW()
           ELSE resolved_at
         END
     WHERE id = $1
       AND status = $4::event_status
     RETURNING id, device_id, type, status, created_at`,
    [eventId, nextStatus, actorId, expectedStatus],
  );

  return result.rows[0] ?? null;
}

export async function monitoringEventExists(eventId: string) {
  const result = await pool.query(
    'SELECT id FROM events WHERE id = $1',
    [eventId],
  );

  return result.rowCount === 1;
}