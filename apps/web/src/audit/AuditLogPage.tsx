import { useEffect, useState } from 'react';
import {
  listAuditLogs,
  type AuditLog,
} from './audit-api';

function formatAction(action: string) {
  return action
    .toLowerCase()
    .split('_')
    .map(
      (part) =>
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ');
}

export function AuditLogPage() {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError('');

    listAuditLogs(limit)
      .then(({ auditLogs }) => {
        if (active) {
          setAuditLogs(auditLogs);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setError(
            error instanceof Error
              ? error.message
              : 'Unable to load the audit log.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [limit, attempt]);

  return (
    <section aria-labelledby="audit-log-heading">
      <h1 id="audit-log-heading">Audit log</h1>

      <label>
        Number of records
        <select
          value={limit}
          disabled={loading}
          onChange={(event) => {
            setLimit(Number(event.target.value));
          }}
        >
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
      </label>

      <button
        type="button"
        disabled={loading}
        onClick={() => setAttempt((value) => value + 1)}
      >
        {loading ? 'Refreshing…' : 'Refresh'}
      </button>

      {loading && auditLogs.length === 0 ? (
        <p role="status">Loading audit log…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : auditLogs.length === 0 ? (
        <p>No audit records have been created yet.</p>
      ) : (
        <ol>
          {auditLogs.map((auditLog) => (
            <li key={auditLog.id}>
              <p>
                <strong>{formatAction(auditLog.action)}</strong>
              </p>

              <p>Actor: {auditLog.actor_name}</p>

              <p>
                Target: {auditLog.target_type} ·{' '}
                <code>{auditLog.target_id}</code>
              </p>

              <p>
                Time:{' '}
                {new Date(
                  auditLog.created_at,
                ).toLocaleString()}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}