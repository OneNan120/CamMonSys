import { apiRequest } from '../api';

export type ResponderSummary = {
  id: string;
  name: string;
};

export function listResponders() {
  return apiRequest<{ responders: ResponderSummary[] }>(
    '/api/responders',
  );
}