import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { createDeviceGroup, listDeviceGroups, deleteDeviceGroup } from './device-group.service.js';
import { notifyDevicesChanged } from '../monitoring/monitoring-events.js';

export const deviceGroupRouter = Router();

const createDeviceGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const deviceGroupIdSchema = z.string().uuid();

function isUniqueViolation(
  error: unknown,
): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

deviceGroupRouter.post(
  '/',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const parsed = createDeviceGroupSchema.safeParse(request.body);

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message:
            'Provide a device-group name between 1 and 100 characters.',
        },
      });
      return;
    }

    try {
      const group = await createDeviceGroup(parsed.data.name, response.locals.user.id,);
      notifyDevicesChanged();
      response.status(201).json({ group });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        response.status(409).json({
          error: {
            code: 'DEVICE_GROUP_NAME_CONFLICT',
            message: 'A device group with that name already exists.',
          },
        });
        return;
      }

      throw error;
    }
  },
);

deviceGroupRouter.get(
  '/',
  requireAuth,
  requireRole('ADMIN', 'MONITOR'),
  async (_request, response) => {
    const groups = await listDeviceGroups();
    response.json({ groups });
  },
);

deviceGroupRouter.delete(
  '/:groupId',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const parsed = deviceGroupIdSchema.safeParse(
      request.params.groupId,
    );

    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide a valid device-group ID.',
        },
      });
      return;
    }

    const group = await deleteDeviceGroup(
      parsed.data,
      response.locals.user.id,
    );

    if (!group) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device group not found.',
        },
      });
      return;
    }

    notifyDevicesChanged();
    response.status(204).send();
  },
);