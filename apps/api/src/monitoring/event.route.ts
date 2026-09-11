import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { listMonitoringEvents, monitoringEventExists, updateMonitoringEventStatus, assignMonitoringEvent, listResponderAssignments, responderHasOtherActiveDeviceAssignment, updateResponderEventStatus } from './monitoring-event.service.js';
import { notifyEventsChanged } from './monitoring-events.js';
import { getActivePublishingSession } from '../devices/publishing.service.js';
import { disconnectResponderFromCamera } from '../video/livekit.service.js';
import { pool } from '../db.js';
import { responderHasActiveDeviceAssignment } from './monitoring-event.service.js';

export const eventRouter = Router();

const listEventsQuerySchema = z.object({
  deviceId: z.string().uuid().optional(),
  assignedTo: z.literal('me').optional(),
});

const eventIdSchema = z.string().uuid();

const updateStatusSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ACKNOWLEDGED'),
  }),
  z.object({
    status: z.literal('RESOLVED'),
    completionNote: z.string().trim().min(1).max(1000).optional(),
  }),
]);

const assignEventSchema = z.union([
  z.object({
    responderId: z.string().uuid(),
    instructions: z.string().trim().min(1).max(1000),
  }),
  z.object({
    responderId: z.null(),
    instructions: z.null().optional(),
  }),
]);

async function disconnectResponderIfAccessEnded(
  responderId: string,
  deviceId: string,
  changedEventId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
  await client.query('BEGIN');
  await client.query('SELECT id FROM devices WHERE id = $1 FOR UPDATE', [deviceId]);
  const hasAnotherAssignment =
    await responderHasActiveDeviceAssignment(
      responderId,
      deviceId,
    );

  if (hasAnotherAssignment) {
    return;
  }

  const publishingSession =
    await getActivePublishingSession(deviceId);

  if (!publishingSession) {
    return;
  }

  await disconnectResponderFromCamera(
    deviceId,
    publishingSession.publishing_session_id,
    responderId,
  );
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

eventRouter.get(
  '/',
  requireAuth,
  async (request, response) => {
    const parsed = listEventsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide valid event filters.',
        },
      });
      return;
    }

    const user = response.locals.user;

    if (user.role === 'RESPONDER') {
      if (
        parsed.data.assignedTo !== 'me' ||
        parsed.data.deviceId !== undefined
      ) {
        response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'Responders may only view their active assignments.',
          },
        });
        return;
      }

      const events = await listResponderAssignments(user.id);
      response.json({ events });
      return;
    }

    if (parsed.data.assignedTo !== undefined) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message:
            'The assignedTo filter is only available to Responders.',
        },
      });
      return;
    }

    const events = await listMonitoringEvents(parsed.data.deviceId);
    response.json({ events });
  },
);

eventRouter.patch(
  '/:eventId/status',
  requireAuth,
  async (request, response) => {
    const eventId = eventIdSchema.safeParse(request.params.eventId);
    const body = updateStatusSchema.safeParse(request.body);

    if (!eventId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide a valid event ID and status update.',
        },
      });
      return;
    }

    const user = response.locals.user;

    if (user.role === 'RESPONDER') {

      const result =
        body.data.status === 'ACKNOWLEDGED'
          ? await updateResponderEventStatus(
              eventId.data,
              user.id,
              {
                status: 'ACKNOWLEDGED',
              },
            )
          : await updateResponderEventStatus(
              eventId.data,
              user.id,
              {
                status: 'RESOLVED',
                completionNote: body.data.completionNote,
              },
            );

      if (result.status === 'EVENT_NOT_FOUND') {
        response.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'Event not found.',
          },
        });
        return;
      }

      if (result.status === 'NOT_ASSIGNED') {
        response.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'This event is not assigned to you.',
          },
        });
        return;
      }

      if (result.status === 'STATUS_CONFLICT') {
        response.status(409).json({
          error: {
            code: 'EVENT_STATUS_CONFLICT',
            message:
              'The event is not in the required status. Refresh and try again.',
          },
        });
        return;
      }

      if (
        result.event.status === 'RESOLVED' &&
        result.event.assigned_to_id
      ) {
        try {
          await disconnectResponderIfAccessEnded(
            result.event.assigned_to_id,
            result.event.device_id,
            result.event.id,
          );
        } catch (error: unknown) {
          console.error(
            'Failed to disconnect the assigned Responder from the camera.',
            error,
          );
        }
      }

      notifyEventsChanged();
      response.json({ event: result.event });
      return;
    }

    const event = await updateMonitoringEventStatus(
      eventId.data,
      body.data.status,
      user.id,
    );

    if (!event) {
      const exists = await monitoringEventExists(eventId.data);

      response.status(exists ? 409 : 404).json({
        error: {
          code: exists ? 'EVENT_STATUS_CONFLICT' : 'NOT_FOUND',
          message: exists
            ? 'The event is not in the required status. Refresh and try again.'
            : 'Event not found.',
        },
      });
      return;
    }

    if (
      body.data.status === 'RESOLVED' &&
      event.assigned_to_id
    ) {
      try {
        await disconnectResponderIfAccessEnded(
          event.assigned_to_id,
          event.device_id,
          event.id,
        );
      } catch (error: unknown) {
        console.error(
          'Failed to disconnect the assigned Responder from the camera.',
          error,
        );
      }
    }

    notifyEventsChanged();
    response.json({ event });
  },
);

eventRouter.patch(
  '/:eventId/assignment',
  requireAuth,
  requireRole('ADMIN', 'MONITOR'),
  async (request, response) => {
    const eventId = eventIdSchema.safeParse(request.params.eventId);
    const body = assignEventSchema.safeParse(request.body);

    if (!eventId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message:
            'Provide a valid event ID, responder, and assignment instructions.',
        },
      });
      return;
    }

    const result = await assignMonitoringEvent(
      eventId.data,
      body.data.responderId,
      body.data.responderId === null
        ? null
        : body.data.instructions,
      response.locals.user.id,
    );

    if (result.status === 'EVENT_NOT_FOUND') {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Event not found.',
        },
      });
      return;
    }

    if (result.status === 'RESPONDER_NOT_FOUND') {
      response.status(404).json({
        error: {
          code: 'RESPONDER_NOT_FOUND',
          message: 'Responder not found.',
        },
      });
      return;
    }

    if (result.status === 'EVENT_RESOLVED') {
      response.status(409).json({
        error: {
          code: 'EVENT_RESOLVED',
          message: 'A resolved event cannot be assigned.',
        },
      });
      return;
    }

    const previousResponderId = result.previousAssignedToId;
    const nextResponderId = result.event.assigned_to_id;

    if (
      previousResponderId &&
      previousResponderId !== nextResponderId
    ) {
      try {
        await disconnectResponderIfAccessEnded(
          previousResponderId,
          result.event.device_id,
          result.event.id,
        );
      } catch (error: unknown) {
        console.error(
          'Failed to disconnect the previous Responder from the camera.',
          error,
        );
      }
    }

    notifyEventsChanged();
    response.json({ event: result.event });
  },
);
