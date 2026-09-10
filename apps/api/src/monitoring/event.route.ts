import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { listMonitoringEvents, monitoringEventExists, updateMonitoringEventStatus } from './monitoring-event.service.js';
import { notifyEventsChanged } from './monitoring-events.js';

export const eventRouter = Router();

const listEventsQuerySchema = z.object({
  deviceId: z.string().uuid().optional(),
});

const eventIdSchema = z.string().uuid();

const updateStatusSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED']),
});

eventRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MONITOR'),
  async (request, response) => {
    const parsed = listEventsQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide a valid device ID.',
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
  requireRole('ADMIN', 'MONITOR'),
  async (request, response) => {
    const eventId = eventIdSchema.safeParse(request.params.eventId);
    const body = updateStatusSchema.safeParse(request.body);

    if (!eventId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide a valid event ID and target status.',
        },
      });
      return;
    }

    const event = await updateMonitoringEventStatus(
      eventId.data,
      body.data.status,
      response.locals.user.id,
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

    notifyEventsChanged();
    response.json({ event });
  },
);