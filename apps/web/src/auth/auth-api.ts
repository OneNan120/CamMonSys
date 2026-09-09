import { apiRequest } from '../api';

export type User = {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'MONITOR' | 'RESPONDER';
};

export function login(email: string, password: string) {
  return apiRequest<{ user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function getCurrentUser() {
  return apiRequest<{ user: User }>('/api/auth/me');
}

export function logout() {
  return apiRequest<void>('/api/auth/logout', {
    method: 'POST',
  });
}