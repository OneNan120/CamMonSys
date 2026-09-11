import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import type { User } from '../auth/auth-api';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';
import {
  listAuditFilterOptions,
  listAuditLogs,
  type AuditFilterOptions,
} from './audit-api';

const empty: AuditFilterOptions = {
  actors: [],
  actions: [],
  targetTypes: [],
};

const label = (v: string) =>
  v
    .toLowerCase()
    .split('_')
    .map((p) => p[0]?.toUpperCase() + p.slice(1))
    .join(' ');

const family = (a: string) =>
  a.includes('ASSIGN')
    ? 'assignment'
    : a.includes('EVENT')
      ? 'event'
      : a.includes('DEVICE_GROUP') || a.includes('GROUP')
        ? 'group'
        : a.includes('DEVICE')
          ? 'device'
          : 'admin';

const targetHref = (t: string, id: string) =>
  t === 'DEVICE'
    ? `/devices/${id}`
    : t === 'EVENT'
      ? `/events/${id}`
      : t === 'DEVICE_GROUP'
        ? `/device-groups?groupId=${id}`
        : t === 'USER'
          ? `/users?userId=${id}`
          : '';

function toLocalInput(iso: string) {
  if (!iso) return '';

  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);

  return local.toISOString().slice(0, 16);
}

export function AuditLogPage({
  currentUser,
}: {
  currentUser: User;
}) {
  const {
    deviceRevision,
    eventRevision,
    connectionState,
  } = useMonitoringStream();

  const [params, setParams] = useSearchParams();

  const [draftSearch, setDraftSearch] = useState(
    params.get('search') ?? '',
  );

  const [logs, setLogs] = useState<
    Awaited<ReturnType<typeof listAuditLogs>>['auditLogs']
  >([]);

  const [options, setOptions] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const admin = currentUser.role === 'ADMIN';

  const actorId = admin
    ? (params.get('actorId') ?? '')
    : currentUser.id;

  useEffect(() => {
    let active = true;

    listAuditFilterOptions()
      .then((v) => active && setOptions(v))
      .catch(
        () => active && setError('Unable to load filter options.'),
      );

    return () => {
      active = false;
    };
  }, [deviceRevision, eventRevision]);

  useEffect(() => {
    const current = params.get('search') ?? '';
    setDraftSearch(current);
  }, [params]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = params.get('search') ?? '';

      if (draftSearch === current) return;

      const next = new URLSearchParams(params);

      draftSearch.trim()
        ? next.set('search', draftSearch.trim())
        : next.delete('search');

      setParams(next, { replace: true });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [draftSearch, params, setParams]);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError('');

    listAuditLogs({
      limit: 100,
      sort:
        params.get('sort') === 'oldest'
          ? 'oldest'
          : 'newest',
      actorId: actorId || undefined,
      search: params.get('search') || undefined,
      action: params.get('action') || undefined,
      targetType: params.get('targetType') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
    })
      .then((r) => active && setLogs(r.auditLogs))
      .catch(
        (e: unknown) =>
          active &&
          setError(
            e instanceof Error
              ? e.message
              : 'Unable to load audit history.',
          ),
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [
    params,
    currentUser.id,
    currentUser.role,
    deviceRevision,
    eventRevision,
  ]);

  const update = (key: string, value: string) => {
    const n = new URLSearchParams(params);

    value ? n.set(key, value) : n.delete(key);

    setParams(n, { replace: true });
  };

  return (
    <section className="audit-page">
      {connectionState === 'reconnecting' && (
        <p className="stream-warning">
          Live updates interrupted. Reconnecting…
        </p>
      )}

      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNTABILITY</p>
          <h2>{admin ? 'Audit Log' : 'My Audit Log'}</h2>
          <p>
            {admin
              ? 'Trace administrative and monitoring activity.'
              : 'Your own recorded monitoring activity.'}
          </p>
        </div>
      </div>

      <div className="audit-filter-bar">
        <label className="device-search">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Search audit log</span>

          <input
            type="search"
            value={draftSearch}
            onChange={(e) => setDraftSearch(e.target.value)}
            placeholder="Search actions, actors, and targets"
          />

          {draftSearch && (
            <button
              type="button"
              aria-label="Clear audit search"
              onClick={() => {
                setDraftSearch('');
                update('search', '');
              }}
            >
              ×
            </button>
          )}
        </label>

        {admin && (
          <label>
            <span>Actor</span>

            <select
              value={actorId}
              onChange={(e) =>
                update('actorId', e.target.value)
              }
            >
              <option value="">All actors</option>

              {options.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          <span>Action</span>

          <select
            value={params.get('action') ?? ''}
            onChange={(e) =>
              update('action', e.target.value)
            }
          >
            <option value="">All actions</option>

            {options.actions.map((a) => (
              <option key={a} value={a}>
                {label(a)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Target</span>

          <select
            value={params.get('targetType') ?? ''}
            onChange={(e) =>
              update('targetType', e.target.value)
            }
          >
            <option value="">All targets</option>

            {options.targetTypes.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>From</span>

          <input
            type="datetime-local"
            value={toLocalInput(params.get('from') ?? '')}
            onChange={(e) =>
              update(
                'from',
                e.target.value
                  ? new Date(e.target.value).toISOString()
                  : '',
              )
            }
          />
        </label>

        <label>
          <span>To</span>

          <input
            type="datetime-local"
            value={toLocalInput(params.get('to') ?? '')}
            onChange={(e) =>
              update(
                'to',
                e.target.value
                  ? new Date(e.target.value).toISOString()
                  : '',
              )
            }
          />
        </label>

        <label>
          <span>Sort</span>

          <select
            value={params.get('sort') ?? 'newest'}
            onChange={(e) =>
              update(
                'sort',
                e.target.value === 'newest'
                  ? ''
                  : e.target.value,
              )
            }
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>

        <button
          type="button"
          className="button-quiet"
          onClick={() => {
            setDraftSearch('');
            setParams(new URLSearchParams(), {
              replace: true,
            });
          }}
        >
          Clear all filters
        </button>
      </div>

      <div className="audit-legend">
        <span className="device">Device</span>
        <span className="event">Event</span>
        <span className="assignment">Assignment</span>
        <span className="group">Group</span>
        <span className="admin">Administration</span>
      </div>

      {loading && logs.length === 0 ? (
        <p role="status">Loading audit history…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : logs.length === 0 ? (
        <p className="empty-panel">
          No audit records match these filters.
        </p>
      ) : (
        <ol className="audit-list">
          {logs.map((log) => {
            const href = targetHref(
              log.target_type,
              log.target_id,
            );

            return (
              <li
                key={log.id}
                className={`audit-row audit-${family(log.action)}`}
              >
                <div>
                  <strong>{label(log.action)}</strong>
                  <time>
                    {new Date(
                      log.created_at,
                    ).toLocaleString()}
                  </time>
                </div>

                <p>
                  Actor:{' '}
                  <button
                    className="inline-button"
                    onClick={() =>
                      update('actorId', log.actor_id)
                    }
                  >
                    {log.actor_name}
                  </button>
                </p>

                <p>
                  Target:{' '}
                  {href ? (
                    <Link to={href}>
                      {label(log.target_type)} ·{' '}
                      {log.target_id}
                    </Link>
                  ) : (
                    <span>
                      {label(log.target_type)} ·{' '}
                      {log.target_id}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}