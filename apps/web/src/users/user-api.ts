import { apiRequest } from '../api';

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MONITOR' | 'RESPONDER';
  created_at: string;
};

export function listUsers() {
  return apiRequest<{
    users: ManagedUser[];
  }>('/api/users');
}

export function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: ManagedUser['role'];
}) {
  return apiRequest<{
    user: ManagedUser;
  }>('/api/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}