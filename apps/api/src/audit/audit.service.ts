import { pool } from '../db.js';

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

export async function listAuditLogs(filters: AuditLogFilters) {
  const conditions: string[] = [];
  const values: unknown[] = [];

  function addValue(value: unknown) {
    values.push(value);
    return `$${values.length}`;
  }

  if (filters.search) {
    const parameter = addValue(filters.search.toLowerCase());

    conditions.push(
      `POSITION(
         ${parameter}
         IN LOWER(
           CONCAT_WS(
             ' ',
             actor.name,
             audit.action,
             audit.target_type,
             audit.target_id::text
           )
         )
       ) > 0`,
    );
  }

  if (filters.actorId) {
    conditions.push(
      `audit.actor_id = ${addValue(filters.actorId)}::uuid`,
    );
  }

  if (filters.action) {
    conditions.push(
      `audit.action = ${addValue(filters.action)}`,
    );
  }

  if (filters.targetType) {
    conditions.push(
      `audit.target_type = ${addValue(filters.targetType)}`,
    );
  }

  if (filters.from) {
    conditions.push(
      `audit.created_at >= ${addValue(filters.from)}::timestamptz`,
    );
  }

  if (filters.to) {
    conditions.push(
      `audit.created_at <= ${addValue(filters.to)}::timestamptz`,
    );
  }

  const limitParameter = addValue(filters.limit);

  const where =
    conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

  const direction =
    filters.sort === 'oldest' ? 'ASC' : 'DESC';

  const result = await pool.query(
    `SELECT
       audit.id,
       audit.action,
       audit.target_type,
       audit.target_id,
       audit.created_at,
       actor.id AS actor_id,
       actor.name AS actor_name
     FROM audit_logs AS audit
     JOIN users AS actor
       ON actor.id = audit.actor_id
     ${where}
     ORDER BY audit.created_at ${direction},
              audit.id ${direction}
     LIMIT ${limitParameter}`,
    values,
  );

  return result.rows;
}

export async function listAuditLogFilterOptions() {
  const [actors, actions, targetTypes] = await Promise.all([
    pool.query(
      `SELECT DISTINCT
         actor.id,
         actor.name
       FROM audit_logs AS audit
       JOIN users AS actor
         ON actor.id = audit.actor_id
       ORDER BY actor.name, actor.id`,
    ),
    pool.query<{ action: string }>(
      `SELECT DISTINCT action
       FROM audit_logs
       ORDER BY action`,
    ),
    pool.query<{ target_type: string }>(
      `SELECT DISTINCT target_type
       FROM audit_logs
       ORDER BY target_type`,
    ),
  ]);

  return {
    actors: actors.rows,
    actions: actions.rows.map((row) => row.action),
    targetTypes: targetTypes.rows.map(
      (row) => row.target_type,
    ),
  };
}