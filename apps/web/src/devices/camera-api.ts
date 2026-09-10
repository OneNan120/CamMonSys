import { apiRequest } from '../api';

export type CameraConnection = {
  serverUrl: string;
  token: string;
};

export type CameraStart = CameraConnection & {
  publishingSessionId: string;
  heartbeatIntervalSeconds: number;
};

export type MonitoringEvent = {
  id: string;
  device_id: string;
  type: 'TEST_ALERT' | 'MOTION' | 'BED_EXIT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  created_at: string;
};

type HeartbeatResponse = {
  lastSeenAt: string;
  leaseExpiresAt: string;
};

function devicePath(deviceId: string) {
  return `/api/devices/${encodeURIComponent(deviceId)}`;
}

export function startCamera(deviceId: string) {
  return apiRequest<CameraStart>(
    `${devicePath(deviceId)}/start`,
    { method: 'POST' },
  );
}

export function sendHeartbeat(
  deviceId: string,
  publishingSessionId: string,
) {
  return apiRequest<HeartbeatResponse>(
    `${devicePath(deviceId)}/heartbeat`,
    {
      method: 'POST',
      body: JSON.stringify({ publishingSessionId }),
    },
  );
}

export function stopCamera(
  deviceId: string,
  publishingSessionId: string,
) {
  return apiRequest<{ message: string }>(
    `${devicePath(deviceId)}/stop`,
    {
      method: 'POST',
      body: JSON.stringify({ publishingSessionId }),
    },
  );
}

export function getViewingConnection(deviceId: string) {
  return apiRequest<CameraConnection>(
    `${devicePath(deviceId)}/view-token`,
    { method: 'POST' },
  );
}

export function createTestAlert(
  deviceId: string,
  publishingSessionId: string,
) {
  return apiRequest<{ event: MonitoringEvent }>(
    `${devicePath(deviceId)}/events`,
    {
      method: 'POST',
      body: JSON.stringify({
        publishingSessionId,
        type: 'TEST_ALERT',
      }),
    },
  );
}