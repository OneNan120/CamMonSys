import { apiRequest } from '../api';

type Device = {
  id: string;
  name: string;
  location: string;
  created_by_id: string;
  group_id: string | null;
  created_at: string;
};

export type DeviceSummary = {
  id: string;
  name: string;
  location: string;
  group_id: string | null;
  last_seen_at: string | null;
  stream_version: string | null;
  created_at: string;
  status: 'ONLINE' | 'OFFLINE';
};

export function listDevices() {
  return apiRequest<{ devices: DeviceSummary[] }>('/api/devices');
}

export function createDevice(
  name: string,
  location: string,
  groupId: string | null = null,
) {
  return apiRequest<{ device: Device }>('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ name, location, groupId }),
  });
}

export function getDevice(deviceId: string) {
  return apiRequest<{ device: DeviceSummary }>(
    `/api/devices/${encodeURIComponent(deviceId)}`,
  );
}

export function deleteDevice(deviceId: string) {
  return apiRequest<void>(
    `/api/devices/${encodeURIComponent(deviceId)}`,
    { method: 'DELETE' },
  );
}

export function updateDeviceGroup(
  deviceId: string,
  groupId: string | null,
) {
  return apiRequest<{
    device: {
      id: string;
      group_id: string | null;
    };
  }>(
    `/api/devices/${encodeURIComponent(deviceId)}/group`,
    {
      method: 'PATCH',
      body: JSON.stringify({ groupId }),
    },
  );
}