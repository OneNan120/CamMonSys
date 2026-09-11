import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  listEvents,
  type MonitoringEvent,
} from '../devices/event-api';
import { EventCard } from './EventCard';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';
import {
  listResponders,
  type ResponderSummary,
} from '../responders/responder-api';

export function EventsPage() {
  const {
    eventRevision,
    connectionState,
  } = useMonitoringStream();

  const [params, setParams] = useSearchParams();

  const [responders, setResponders] = useState<
    ResponderSummary[]
  >([]);

  const [events, setEvents] = useState<
    MonitoringEvent[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    Promise.all([
      listEvents(),
      listResponders().catch(() => ({
        responders: [],
      })),
    ])
      .then(([e, r]) => {
        if (active) {
          setEvents(e.events);
          setResponders(r.responders);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : 'Unable to load events.',
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
  }, [eventRevision]);

  const value = (k: string) =>
    params.get(k) ?? '';

  const update = (
    k: string,
    v: string,
  ) => {
    const n = new URLSearchParams(params);

    v
      ? n.set(k, v)
      : n.delete(k);

    setParams(n, {
      replace: true,
    });
  };

  const search = value('search');
  const status = value('status');
  const type = value('type');
  const deviceId = value('deviceId');
  const location = value('location');
  const assignment = value('assignment');
  const sort = value('sort') || 'newest';
  const eventId = value('eventId');

  const devices = useMemo(
    () =>
      Array.from(
        new Map(
          events.map((e) => [
            e.device_id,
            e.device_name,
          ]),
        ).entries(),
      ),
    [events],
  );

  const types = Array.from(
    new Set(
      events.map((e) => e.type),
    ),
  );

  const locations = Array.from(
    new Set(
      events.map(
        (e) => e.device_location,
      ),
    ),
  );

  const shown = useMemo(
    () =>
      events
        .filter(
          (e) =>
            (!search ||
              `${e.type} ${e.device_name} ${e.device_location}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (!status ||
              e.status === status) &&
            (!type ||
              e.type === type) &&
            (!deviceId ||
              e.device_id === deviceId) &&
            (!location ||
              e.device_location ===
                location) &&
            (!assignment ||
              (assignment === 'assigned'
                ? !!e.assigned_to_id
                : !e.assigned_to_id)),
        )
        .sort(
          (a, b) =>
            (sort === 'oldest'
              ? 1
              : -1) *
            (new Date(
              a.created_at,
            ).getTime() -
              new Date(
                b.created_at,
              ).getTime()),
        ),
    [
      events,
      search,
      status,
      type,
      deviceId,
      location,
      assignment,
      sort,
    ],
  );

  return (
    <section>
      {connectionState ===
        'reconnecting' && (
        <p
          className="stream-warning"
          role="status"
        >
          Live updates interrupted.
          Reconnecting…
        </p>
      )}

      <div className="page-heading">
        <div>
          <p className="eyebrow">
            INCIDENT OPERATIONS
          </p>

          <h2>Events</h2>

          <p>
            Review and follow monitoring events
            through resolution.
          </p>
        </div>

        <span className="count-pill">
          {shown.length} shown
        </span>
      </div>

      <div className="filter-bar filter-bar-wide">
        <label className="device-search">
          <span aria-hidden="true">
            ⌕
          </span>

          <span className="sr-only">
            Search events
          </span>

          <input
            type="search"
            value={search}
            onChange={(e) =>
              update(
                'search',
                e.target.value,
              )
            }
            placeholder="Search event, device, or location"
          />

          {search && (
            <button
              type="button"
              aria-label="Clear event search"
              onClick={() =>
                update('search', '')
              }
            >
              ×
            </button>
          )}
        </label>

        <label>
          Status

          <select
            value={status}
            onChange={(e) =>
              update(
                'status',
                e.target.value,
              )
            }
          >
            <option value="">
              All
            </option>

            <option value="OPEN">
              Open
            </option>

            <option value="ACKNOWLEDGED">
              Acked
            </option>

            <option value="RESOLVED">
              Resolved
            </option>
          </select>
        </label>

        <label>
          Type

          <select
            value={type}
            onChange={(e) =>
              update(
                'type',
                e.target.value,
              )
            }
          >
            <option value="">
              All
            </option>

            {types.map((t) => (
              <option key={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label>
          Device

          <select
            value={deviceId}
            onChange={(e) =>
              update(
                'deviceId',
                e.target.value,
              )
            }
          >
            <option value="">
              All
            </option>

            {devices.map(
              ([id, name]) => (
                <option
                  key={id}
                  value={id}
                >
                  {name}
                </option>
              ),
            )}
          </select>
        </label>

        <label>
          Location

          <select
            value={location}
            onChange={(e) =>
              update(
                'location',
                e.target.value,
              )
            }
          >
            <option value="">
              All
            </option>

            {locations.map((l) => (
              <option key={l}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label>
          Assignment

          <select
            value={assignment}
            onChange={(e) =>
              update(
                'assignment',
                e.target.value,
              )
            }
          >
            <option value="">
              All
            </option>

            <option value="assigned">
              Assigned
            </option>

            <option value="unassigned">
              Unassigned
            </option>
          </select>
        </label>

        <label>
          Sort

          <select
            value={sort}
            onChange={(e) =>
              update(
                'sort',
                e.target.value,
              )
            }
          >
            <option value="newest">
              Newest
            </option>

            <option value="oldest">
              Oldest
            </option>
          </select>
        </label>

        <button
          type="button"
          className="button-quiet"
          onClick={() =>
            setParams(
              new URLSearchParams(),
              {
                replace: true,
              },
            )
          }
        >
          Clear all filters
        </button>
      </div>

      {loading ? (
        <p role="status">
          Loading events…
        </p>
      ) : error ? (
        <p role="alert">
          {error}
        </p>
      ) : shown.length === 0 ? (
        <p className="empty-panel">
          No events match the selected filters.
        </p>
      ) : (
        <div className="event-directory">
          {shown.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              defaultOpen={
                e.id === eventId
              }
              canAssign
              responders={responders}
            />
          ))}
        </div>
      )}
    </section>
  );
}