import { pool } from '../db.js';

export type MonitoringEventType = | 'TEST_ALERT' | 'MOTION' | 'BED_EXIT';

type MonitoringEventRow = {
  id: string;
  device_id: string;
  type: MonitoringEventType;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  created_at: Date;
  assigned_to_id: string | null;
};

type EventAssignmentRow = {
  id: string;
  device_id: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  assigned_to_id: string | null;
  assigned_by_id: string | null;
  instructions: string | null;
};

export type AssignMonitoringEventResult =
  | {
      status: 'ASSIGNED';
      event: EventAssignmentRow;
      previousAssignedToId: string | null;
    }
  | {
      status: 'EVENT_NOT_FOUND';
    }
  | {
      status: 'RESPONDER_NOT_FOUND';
    }
  | {
      status: 'EVENT_RESOLVED';
};

type ResponderEventUpdate =
  | {
      status: 'ACKNOWLEDGED';
    }
  | {
      status: 'RESOLVED';
      completionNote?: string;
};

export type UpdateResponderEventResult =
  | {
      status: 'UPDATED';
      event: MonitoringEventRow & {
        completion_note: string | null;
      };
    }
  | {
      status: 'EVENT_NOT_FOUND';
    }
  | {
      status: 'NOT_ASSIGNED';
    }
  | {
      status: 'STATUS_CONFLICT';
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
     RETURNING id, device_id, type, status, created_at, assigned_to_id`,
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
      e.assigned_to_id,
      assigned_to.name AS assigned_to_name,
      assigned_by.name AS assigned_by_name,
      e.instructions,
      e.completion_note,
      e.acknowledged_at,
      acknowledged_by.name AS acknowledged_by_name,
      e.resolved_at,
      resolved_by.name AS resolved_by_name
    FROM events AS e
    JOIN devices AS d ON d.id = e.device_id
    LEFT JOIN users AS assigned_to
      ON assigned_to.id = e.assigned_to_id
    LEFT JOIN users AS assigned_by
      ON assigned_by.id = e.assigned_by_id
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
    `WITH updated_event AS (
      UPDATE events
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
      RETURNING id, device_id, type, status, created_at, assigned_to_id
    ),
    audit_entry AS (
      INSERT INTO audit_logs (
        actor_id,
        action,
        target_type,
        target_id
      )
      SELECT
        $3::uuid,
        CASE
          WHEN $2::event_status = 'ACKNOWLEDGED'
            THEN 'EVENT_ACKNOWLEDGED'
          ELSE 'EVENT_RESOLVED'
        END,
        'EVENT',
        id
      FROM updated_event
      RETURNING id
    )
    SELECT updated_event.*
    FROM updated_event
    JOIN audit_entry ON TRUE`,
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

export async function assignMonitoringEvent(
  eventId: string,
  responderId: string | null,
  instructions: string | null,
  actorId: string,
): Promise<AssignMonitoringEventResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const eventResult = await client.query<{
      status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      assigned_to_id: string | null;
    }>(
      `SELECT status, assigned_to_id
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );

    const existingEvent = eventResult.rows[0];

    if (!existingEvent) {
      await client.query('ROLLBACK');
      return { status: 'EVENT_NOT_FOUND' };
    }

    if (existingEvent.status === 'RESOLVED') {
      await client.query('ROLLBACK');
      return { status: 'EVENT_RESOLVED' };
    }

    if (responderId) {
      const responder = await client.query(
        `SELECT id
         FROM users
         WHERE id = $1
           AND role = 'RESPONDER'
         FOR KEY SHARE`,
        [responderId],
      );

      if (responder.rowCount !== 1) {
        await client.query('ROLLBACK');
        return { status: 'RESPONDER_NOT_FOUND' };
      }
    }

    const update = await client.query<EventAssignmentRow>(
      `UPDATE events
       SET assigned_to_id = $2,
           assigned_by_id = $4,
           instructions = CASE
             WHEN $2::uuid IS NULL THEN NULL
             ELSE $3
           END
       WHERE id = $1
       RETURNING
         id,
         device_id,
         status,
         assigned_to_id,
         assigned_by_id,
         instructions`,
      [eventId, responderId, instructions, actorId],
    );

    const event = update.rows[0];

    if (!event) {
      throw new Error('Event assignment returned no record.');
    }

    const action =
      responderId === null
        ? 'EVENT_UNASSIGNED'
        : existingEvent.assigned_to_id === null
          ? 'EVENT_ASSIGNED'
          : 'EVENT_REASSIGNED';

    await client.query(
      `INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       VALUES ($1, $2, 'EVENT', $3)`,
      [actorId, action, eventId],
    );

    await client.query('COMMIT');

    return {
      status: 'ASSIGNED',
      event,
      previousAssignedToId: existingEvent.assigned_to_id,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listResponderAssignments(responderId: string) {
  const result = await pool.query(
    `SELECT
       e.id,
       e.device_id,
       d.name AS device_name,
       d.location AS device_location,
       e.type,
       e.status,
       e.created_at,
       e.assigned_to_id,
       assigned_to.name AS assigned_to_name,
       assigned_by.name AS assigned_by_name,
       e.instructions,
       e.completion_note,
       e.acknowledged_at,
       acknowledged_by.name AS acknowledged_by_name,
       e.resolved_at,
       resolved_by.name AS resolved_by_name
     FROM events AS e
     JOIN devices AS d
       ON d.id = e.device_id
      AND d.deleted_at IS NULL
     LEFT JOIN users AS assigned_to
       ON assigned_to.id = e.assigned_to_id
     LEFT JOIN users AS assigned_by
       ON assigned_by.id = e.assigned_by_id
     LEFT JOIN users AS acknowledged_by
       ON acknowledged_by.id = e.acknowledged_by_id
     LEFT JOIN users AS resolved_by
       ON resolved_by.id = e.resolved_by_id
     WHERE e.assigned_to_id = $1
       AND e.status <> 'RESOLVED'
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT 100`,
    [responderId],
  );

  return result.rows;
}

export async function responderHasActiveDeviceAssignment(
  responderId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM events AS e
     JOIN devices AS d
       ON d.id = e.device_id
      AND d.deleted_at IS NULL
     WHERE e.assigned_to_id = $1
       AND e.device_id = $2
       AND e.status <> 'RESOLVED'
     LIMIT 1`,
    [responderId, deviceId],
  );

  return result.rowCount === 1;
}

export async function responderHasOtherActiveDeviceAssignment(
  responderId: string,
  deviceId: string,
  excludedEventId: string,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
     FROM events
     WHERE assigned_to_id = $1
       AND device_id = $2
       AND id <> $3
       AND status <> 'RESOLVED'
     LIMIT 1`,
    [responderId, deviceId, excludedEventId],
  );

  return result.rowCount === 1;
}

export async function updateResponderEventStatus(
  eventId: string,
  responderId: string,
  update: ResponderEventUpdate,
): Promise<UpdateResponderEventResult> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query<{
      status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      assigned_to_id: string | null;
    }>(
      `SELECT status, assigned_to_id
       FROM events
       WHERE id = $1
       FOR UPDATE`,
      [eventId],
    );

    const currentEvent = currentResult.rows[0];

    if (!currentEvent) {
      await client.query('ROLLBACK');
      return { status: 'EVENT_NOT_FOUND' };
    }

    if (currentEvent.assigned_to_id !== responderId) {
      await client.query('ROLLBACK');
      return { status: 'NOT_ASSIGNED' };
    }

    const expectedStatus =
      update.status === 'ACKNOWLEDGED'
        ? 'OPEN'
        : 'ACKNOWLEDGED';

    if (currentEvent.status !== expectedStatus) {
      await client.query('ROLLBACK');
      return { status: 'STATUS_CONFLICT' };
    }

    const completionNote =
      update.status === 'RESOLVED'
        ? update.completionNote ?? null
        : null;

    const updatedResult = await client.query<
      MonitoringEventRow & {
        completion_note: string | null;
      }
    >(
      `UPDATE events
       SET status = $2::event_status,
           acknowledged_by_id = CASE
             WHEN $2::event_status = 'ACKNOWLEDGED'
               THEN $3::uuid
             ELSE acknowledged_by_id
           END,
           acknowledged_at = CASE
             WHEN $2::event_status = 'ACKNOWLEDGED'
               THEN NOW()
             ELSE acknowledged_at
           END,
           resolved_by_id = CASE
             WHEN $2::event_status = 'RESOLVED'
               THEN $3::uuid
             ELSE resolved_by_id
           END,
           resolved_at = CASE
             WHEN $2::event_status = 'RESOLVED'
               THEN NOW()
             ELSE resolved_at
           END,
           completion_note = CASE
             WHEN $2::event_status = 'RESOLVED'
               THEN $4
             ELSE completion_note
           END
       WHERE id = $1
       RETURNING
         id,
         device_id,
         type,
         status,
         created_at,
         assigned_to_id,
         completion_note`,
      [
        eventId,
        update.status,
        responderId,
        completionNote,
      ],
    );

    const event = updatedResult.rows[0];

    if (!event) {
      throw new Error('Responder event update returned no record.');
    }

    await client.query(
      `INSERT INTO audit_logs (
         actor_id,
         action,
         target_type,
         target_id
       )
       VALUES (
         $1,
         $2,
         'EVENT',
         $3
       )`,
      [
        responderId,
        update.status === 'ACKNOWLEDGED'
          ? 'EVENT_ACKNOWLEDGED'
          : 'EVENT_RESOLVED',
        eventId,
      ],
    );

    await client.query('COMMIT');

    return {
      status: 'UPDATED',
      event,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}