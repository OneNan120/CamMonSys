import { pool } from '../db.js';

export async function listAuditLogs(limit: number) {
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
     ORDER BY audit.created_at DESC, audit.id DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows;
}