import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { createDevice, listDevices, getDeviceById } from './device.service.js';

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

deviceRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MONITOR'),
  async (_request, response) => {
    const devices = await listDevices();

    response.json({ devices });
  },
);

const deviceIdSchema = z.string().uuid();

deviceRouter.get(
  '/:deviceId',
  requireAuth,
  requireRole('ADMIN', 'MONITOR'),
  async (request, response) => {
    const parsed = deviceIdSchema.safeParse(request.params.deviceId);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide a valid device ID.',
        },
      });
      return;
    }

    const device = await getDeviceById(parsed.data);

    if (!device) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found.',
        },
      });
      return;
    }

    response.json({ device });
  },
);