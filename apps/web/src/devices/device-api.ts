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
  created_at: string;
  status: 'ONLINE' | 'OFFLINE';
};

export function listDevices() {
  return apiRequest<{ devices: DeviceSummary[] }>('/api/devices');
}

export function createDevice(name: string, location: string) {
  return apiRequest<{ device: Device }>('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ name, location }),
  });
}

export function getDevice(deviceId: string) {
  return apiRequest<{ device: DeviceSummary }>(
    `/api/devices/${encodeURIComponent(deviceId)}`,
  );
}
