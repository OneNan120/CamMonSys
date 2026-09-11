import { type FormEvent, useEffect, useState, } from 'react';
import {
  listAuditFilterOptions,
  listAuditLogs,
  type AuditFilterOptions,
  type AuditLog,
  type AuditLogFilters,
} from './audit-api';

type TimeRange =
  | 'all'
  | '24-hours'
  | '7-days'
  | '30-days'
  | 'custom';

const emptyOptions: AuditFilterOptions = {
  actors: [],
  actions: [],
  targetTypes: [],
};

const initialFilters: AuditLogFilters = {
  limit: 100,
  sort: 'newest',
};

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

function getPresetStart(timeRange: TimeRange) {
  const now = Date.now();

  switch (timeRange) {
    case '24-hours':
      return new Date(now - 24 * 60 * 60 * 1000).toISOString();

    case '7-days':
      return new Date(
        now - 7 * 24 * 60 * 60 * 1000,
      ).toISOString();

    case '30-days':
      return new Date(
        now - 30 * 24 * 60 * 60 * 1000,
      ).toISOString();

    default:
      return undefined;
  }
}

function localDateTimeToIso(value: string) {
  if (!value) return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? undefined
    : date.toISOString();
}

export function AuditLogPage() {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [options, setOptions] =
    useState<AuditFilterOptions>(emptyOptions);

  const [filters, setFilters] =
    useState<AuditLogFilters>(initialFilters);

  const [search, setSearch] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [timeRange, setTimeRange] =
    useState<TimeRange>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [sort, setSort] =
    useState<'newest' | 'oldest'>('newest');
  const [limit, setLimit] = useState(100);

  const [loading, setLoading] = useState(true);
  const [optionsError, setOptionsError] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    listAuditFilterOptions()
      .then((result) => {
        if (active) {
          setOptions(result);
          setOptionsError('');
        }
      })
      .catch(() => {
        if (active) {
          setOptionsError(
            'Unable to load audit filter options.',
          );
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError('');

    listAuditLogs(filters)
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
  }, [filters, attempt]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const from =
      timeRange === 'custom'
        ? localDateTimeToIso(customFrom)
        : getPresetStart(timeRange);

    const to =
      timeRange === 'custom'
        ? localDateTimeToIso(customTo)
        : undefined;

    setFilters({
      limit,
      sort,
      search: search.trim() || undefined,
      actorId: actorId || undefined,
      action: action || undefined,
      targetType: targetType || undefined,
      from,
      to,
    });
  }

  function handleReset() {
    setSearch('');
    setActorId('');
    setAction('');
    setTargetType('');
    setTimeRange('all');
    setCustomFrom('');
    setCustomTo('');
    setSort('newest');
    setLimit(100);
    setFilters(initialFilters);
  }

  return (
    <section aria-labelledby="audit-log-heading">
      <h1 id="audit-log-heading">Audit log</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Search
          <input
            type="search"
            value={search}
            maxLength={100}
            placeholder="Actor, action, target type, or ID"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label>
          Actor
          <select
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
          >
            <option value="">All actors</option>

            {options.actors.map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Event or action type
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="">All actions</option>

            {options.actions.map((option) => (
              <option key={option} value={option}>
                {formatAction(option)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Target type
          <select
            value={targetType}
            onChange={(event) =>
              setTargetType(event.target.value)
            }
          >
            <option value="">All target types</option>

            {options.targetTypes.map((option) => (
              <option key={option} value={option}>
                {formatAction(option)}
              </option>
            ))}
          </select>
        </label>

        <label>
          Time
          <select
            value={timeRange}
            onChange={(event) =>
              setTimeRange(event.target.value as TimeRange)
            }
          >
            <option value="all">All time</option>
            <option value="24-hours">Last 24 hours</option>
            <option value="7-days">Last 7 days</option>
            <option value="30-days">Last 30 days</option>
            <option value="custom">Custom range</option>
          </select>
        </label>

        {timeRange === 'custom' && (
          <>
            <label>
              From
              <input
                type="datetime-local"
                value={customFrom}
                onChange={(event) =>
                  setCustomFrom(event.target.value)
                }
              />
            </label>

            <label>
              To
              <input
                type="datetime-local"
                value={customTo}
                min={customFrom || undefined}
                onChange={(event) =>
                  setCustomTo(event.target.value)
                }
              />
            </label>
          </>
        )}

        <label>
          Sort
          <select
            value={sort}
            onChange={(event) =>
              setSort(
                event.target.value as 'newest' | 'oldest',
              )
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </label>

        <label>
          Number of records
          <select
            value={limit}
            onChange={(event) =>
              setLimit(Number(event.target.value))
            }
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
          </select>
        </label>

        <button type="submit" disabled={loading}>
          {loading ? 'Loading…' : 'Apply filters'}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={handleReset}
        >
          Reset filters
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh
        </button>
      </form>

      {optionsError && <p role="alert">{optionsError}</p>}

      {loading && auditLogs.length === 0 ? (
        <p role="status">Loading audit log…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : auditLogs.length === 0 ? (
        <p>No audit records match the selected filters.</p>
      ) : (
        <>
          <p>{auditLogs.length} records shown</p>

          <ol>
            {auditLogs.map((auditLog) => (
              <li key={auditLog.id}>
                <p>
                  <strong>
                    {formatAction(auditLog.action)}
                  </strong>
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
        </>
      )}
    </section>
  );
}