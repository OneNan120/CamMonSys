import { Router } from 'express';
import { pool } from '../db.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireAuth } from '../auth/require-auth.js';
import { requireRole } from '../auth/require-role.js';
import { createDevice, listDevices, getDeviceById, deleteDevice, assignDeviceGroup } from './device.service.js';
import { env } from '../config.js';
import { createCameraToken } from '../video/livekit.service.js';
import { reservePublishingSession, releasePublishingSession, renewPublishingSession, getActivePublishingSession } from './publishing.service.js';
import { createMonitoringEvent } from '../monitoring/monitoring-event.service.js';
import { notifyEventsChanged, notifyDevicesChanged } from '../monitoring/monitoring-events.js';
import { responderHasActiveDeviceAssignment } from '../monitoring/monitoring-event.service.js';

export const deviceRouter = Router();

const createDeviceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  location: z.string().trim().min(1).max(200),
  groupId: z.string().uuid().nullable().optional(),
});

const heartbeatSchema = z.object({
  publishingSessionId: z.string().uuid(),
});

const stopSchema = z.object({
  publishingSessionId: z.string().uuid(),
});

const createEventSchema = z.object({
  publishingSessionId: z.string().uuid(),
  type: z.enum(['TEST_ALERT', 'MOTION', 'BED_EXIT']),
});

const assignDeviceGroupSchema = z.object({
  groupId: z.string().uuid().nullable(),
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

    const result = await createDevice(
      parsed.data.name,
      parsed.data.location,
      response.locals.user.id,
      parsed.data.groupId ?? null,
    );

    if (result.status === 'GROUP_NOT_FOUND') {
      response.status(404).json({
        error: {
          code: 'DEVICE_GROUP_NOT_FOUND',
          message: 'Device group not found.',
        },
      });
      return;
    }

    notifyDevicesChanged();

    response.status(201).json({ device: result.device });
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

deviceRouter.post(
  '/:deviceId/events',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const deviceId = deviceIdSchema.safeParse(request.params.deviceId);
    const body = createEventSchema.safeParse(request.body);

    if (!deviceId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide valid device, session, and event details.',
        },
      });
      return;
    }

    const device = await getDeviceById(deviceId.data);

    if (!device) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found.',
        },
      });
      return;
    }

    const event = await createMonitoringEvent(
      deviceId.data,
      body.data.publishingSessionId,
      response.locals.sessionId,
      body.data.type,
    );

    if (!event) {
      response.status(409).json({
        error: {
          code: 'PUBLISHING_SESSION_INACTIVE',
          message: 'The camera session is no longer active.',
        },
      });
      return;
    }

    notifyEventsChanged();
    response.status(201).json({ event });
  },
);

const deviceIdSchema = z.string().uuid();

async function canViewDevice(
  user: {
    id: string;
    role: 'ADMIN' | 'MONITOR' | 'RESPONDER';
  },
  deviceId: string,
): Promise<boolean> {
  if (user.role === 'ADMIN' || user.role === 'MONITOR') {
    return true;
  }

  return responderHasActiveDeviceAssignment(user.id, deviceId);
}

deviceRouter.get(
  '/:deviceId',
  requireAuth,
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

    const user = response.locals.user;

    if (!(await canViewDevice(user, parsed.data))) {
      response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have an active assignment for this device.',
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

deviceRouter.patch(
  '/:deviceId/group',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const deviceId = deviceIdSchema.safeParse(request.params.deviceId);
    const body = assignDeviceGroupSchema.safeParse(request.body);

    if (!deviceId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message:
            'Provide a valid device ID and a groupId UUID or null.',
        },
      });
      return;
    }

    const result = await assignDeviceGroup(
      deviceId.data,
      body.data.groupId,
      response.locals.user.id,
    );

    if (result.status === 'NOT_FOUND') {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found.',
        },
      });
      return;
    }

    if (result.status === 'GROUP_NOT_FOUND') {
      response.status(404).json({
        error: {
          code: 'DEVICE_GROUP_NOT_FOUND',
          message: 'Device group not found.',
        },
      });
      return;
    }

    notifyDevicesChanged();
    response.json({ device: result.device });
  },
);

deviceRouter.delete(
  '/:deviceId',
  requireAuth,
  requireRole('ADMIN'),
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

    const result = await deleteDevice(
      parsed.data,
      response.locals.user.id,
    );

    if (result === 'NOT_FOUND') {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found.',
        },
      });
      return;
    }

    if (result === 'HAS_UNRESOLVED_EVENTS') {
      response.status(409).json({
        error: {
          code: 'DEVICE_HAS_UNRESOLVED_EVENTS',
          message:
            'Resolve all events for this device before deleting it.',
        },
      });
      return;
    }

    notifyDevicesChanged();
    response.status(204).send();
  },
);

deviceRouter.post(
  '/:deviceId/start',
  requireAuth,
  requireRole('ADMIN'),
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

    const deviceId = parsed.data;
    const ownerSessionId = response.locals.sessionId;

    const device = await getDeviceById(deviceId);

    if (!device) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found.',
        },
      });
      return;
    }

    const reservation = await reservePublishingSession(
      deviceId,
      ownerSessionId,
    );

    if (!reservation) {
      response.status(409).json({
        error: {
          code: 'PUBLISHING_CONFLICT',
          message: 'The device is unavailable or already reserved.',
        },
      });
      return;
    }

    const publishingSessionId = reservation.publishing_session_id;

    try {
      const connection = await createCameraToken(
        deviceId,
        publishingSessionId,
        `publisher-${publishingSessionId}`,
        'publish',
      );

      response.set('Cache-Control', 'no-store');
      response.json({
        ...connection,
        publishingSessionId,
        heartbeatIntervalSeconds:
          env.CAMERA_HEARTBEAT_INTERVAL_SECONDS,
      });
    } catch (error) {
      await releasePublishingSession(
        deviceId,
        publishingSessionId,
        ownerSessionId,
      );

      throw error;
    }
  },
);

deviceRouter.post(
  '/:deviceId/heartbeat',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const deviceId = deviceIdSchema.safeParse(request.params.deviceId);
    const body = heartbeatSchema.safeParse(request.body);

    if (!deviceId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide valid device and publishing-session IDs.',
        },
      });
      return;
    }

    const renewed = await renewPublishingSession(
      deviceId.data,
      body.data.publishingSessionId,
      response.locals.sessionId,
    );

    if (!renewed) {
      response.status(409).json({
        error: {
          code: 'PUBLISHING_SESSION_INACTIVE',
          message: 'The camera session is no longer active. Start again.',
        },
      });
      return;
    }

    response.json({
      lastSeenAt: renewed.last_seen_at,
      leaseExpiresAt: renewed.publishing_lease_expires_at,
    });
  },
);

deviceRouter.post(
  '/:deviceId/stop',
  requireAuth,
  requireRole('ADMIN'),
  async (request, response) => {
    const deviceId = deviceIdSchema.safeParse(request.params.deviceId);
    const body = stopSchema.safeParse(request.body);

    if (!deviceId.success || !body.success) {
      response.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'Provide valid device and publishing-session IDs.',
        },
      });
      return;
    }

    const released = await releasePublishingSession(
      deviceId.data,
      body.data.publishingSessionId,
      response.locals.sessionId,
    );

    if (!released) {
      response.status(409).json({
        error: {
          code: 'PUBLISHING_SESSION_INACTIVE',
          message: 'This camera session is no longer current.',
        },
      });
      return;
    }

    response.status(202).json({
      message: 'Camera reservation released; room cleanup queued.',
    });
  },
);

deviceRouter.post(
  '/:deviceId/view-token',
  requireAuth,
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

    const deviceId = parsed.data;

    const user = response.locals.user;

    if (!(await canViewDevice(user, deviceId))) {
      response.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have an active assignment for this device.',
        },
      });
      return;
    }

    if (!(await getDeviceById(deviceId))) {
      response.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found.',
        },
      });
      return;
    }

    const session = await getActivePublishingSession(deviceId);

    if (!session) {
      response.status(409).json({
        error: {
          code: 'CAMERA_OFFLINE',
          message: 'This camera is not currently reporting.',
        },
      });
      return;
    }

    // Serialize token issuance with assignment revocation and room replacement.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM devices WHERE id = $1 FOR UPDATE', [deviceId]);
      const current = await getActivePublishingSession(deviceId);
      if (!(await canViewDevice(user, deviceId)) ||
          current?.publishing_session_id !== session.publishing_session_id) {
        response.status(409).json({
          error: { code: 'CAMERA_ACCESS_CHANGED', message: 'Camera access changed. Refresh and retry.' },
        });
        return;
      }
    const participantIdentity =
      user.role === 'RESPONDER'
        ? `responder-${user.id}`
        : `viewer-${randomUUID()}`;

    const connection = await createCameraToken(
      deviceId,
      session.publishing_session_id,
      participantIdentity,
      'view',
    );

    response.set('Cache-Control', 'no-store');
    response.json(connection);
    } finally {
      try { await client.query('ROLLBACK'); } finally { client.release(); }
    }
  },
);
