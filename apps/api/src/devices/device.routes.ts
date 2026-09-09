import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { createDevice } from './device.service.js';

export const deviceRouter = Router();

const createDeviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().min(1).max(200),
});

deviceRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const parsed = createDeviceSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message:
            'Provide a device name (1–100 characters) and location (1–200 characters).',
        },
      });
      return;
    }

    const device = await createDevice(
      parsed.data.name,
      parsed.data.location,
      response.locals.user.id,
    );

    response.status(201).json({ device });
  },
);