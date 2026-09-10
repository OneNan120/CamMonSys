import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { listMonitoringEvents } from './monitoring-event.service.js';

export const eventRouter = Router();

const listEventsQuerySchema = z.object({
  deviceId: z.string().uuid().optional(),
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