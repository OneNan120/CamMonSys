import { apiRequest } from '../api';

export type DeviceGroup = {
  id: string;
  name: string;
  created_at: string;
};

export function listDeviceGroups() {
  return apiRequest<{ groups: DeviceGroup[] }>(
    '/api/device-groups',
  );
}

export function createDeviceGroup(name: string) {
  return apiRequest<{ group: DeviceGroup }>(
    '/api/device-groups',
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  );
}

export function deleteDeviceGroup(groupId: string) {
  return apiRequest<void>(
    `/api/device-groups/${encodeURIComponent(groupId)}`,
    {
      method: 'DELETE',
    },
  );
}