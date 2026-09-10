import { apiRequest } from '../api';

export type AuditLog = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  created_at: string;
  actor_id: string;
  actor_name: string;
};

export function listAuditLogs(limit = 100) {
  return apiRequest<{ auditLogs: AuditLog[] }>(
    `/api/audit-logs?limit=${encodeURIComponent(limit)}`,
  );
}