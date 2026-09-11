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

export type AuditLogFilters = {
  limit: number;
  search?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  sort: 'newest' | 'oldest';
};

export type AuditFilterOptions = {
  actors: Array<{
    id: string;
    name: string;
  }>;
  actions: string[];
  targetTypes: string[];
};

export function listAuditLogs(filters: AuditLogFilters) {
  const query = new URLSearchParams({
    limit: String(filters.limit),
    sort: filters.sort,
  });

  if (filters.search) {
    query.set('search', filters.search);
  }

  if (filters.actorId) {
    query.set('actorId', filters.actorId);
  }

  if (filters.action) {
    query.set('action', filters.action);
  }

  if (filters.targetType) {
    query.set('targetType', filters.targetType);
  }

  if (filters.from) {
    query.set('from', filters.from);
  }

  if (filters.to) {
    query.set('to', filters.to);
  }

  return apiRequest<{ auditLogs: AuditLog[] }>(
    `/api/audit-logs?${query.toString()}`,
  );
}

export function listAuditFilterOptions() {
  return apiRequest<AuditFilterOptions>(
    '/api/audit-logs/filter-options',
  );
}