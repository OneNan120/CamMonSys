import { apiRequest } from '../api';

type Device = {
  id: string;
  name: string;
  location: string;
  created_by_id: string;
  group_id: string | null;
  created_at: string;
};

export function createDevice(name: string, location: string) {
  return apiRequest<{ device: Device }>('/api/devices', {
    method: 'POST',
    body: JSON.stringify({ name, location }),
  });
}