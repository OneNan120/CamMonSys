import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../api';
import {
  getEvent,
  updateEventStatus,
  type MonitoringEvent,
} from '../devices/event-api';
import { EventStatus } from './EventCard';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';
import {
  listResponders,
  type ResponderSummary,
} from '../responders/responder-api';
import { EventAssignmentEditor } from './EventAssignmentEditor';
import { EventSnapshot } from './EventSnapshot';

export function EventDetailPage({
  canAssign,
}: {
  canAssign: boolean;
}) {
  const {
    eventRevision,
    connectionState,
  } = useMonitoringStream();

  const { eventId } = useParams();

  const [responders, setResponders] = useState<
    ResponderSummary[]
  >([]);

  const [event, setEvent] =
    useState<MonitoringEvent | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!canAssign) return;

    let active = true;

    listResponders()
      .then(
        (r) =>
          active &&
          setResponders(r.responders),
      )
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [canAssign]);

  const load = async () => {
    if (!eventId) return;

    setLoading(true);

    try {
      setEvent(
        (await getEvent(eventId)).event,
      );

      setError('');
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to load event.',
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [eventId, eventRevision]);

  const advance = async () => {
    if (
      !event ||
      event.status === 'RESOLVED'
    ) {
      return;
    }

    setUpdating(true);

    try {
      await updateEventStatus(
        event.id,
        event.status === 'OPEN'
          ? 'ACKNOWLEDGED'
          : 'RESOLVED',
        note || undefined,
      );

      await load();
    } catch (e) {
      setError(
        e instanceof ApiError &&
          e.status === 409
          ? 'This event changed. Refresh and try again.'
          : e instanceof Error
            ? e.message
            : 'Unable to update event.',
      );
    } finally {
      setUpdating(false);
    }
  };

  if (loading && !event) {
    return (
      <p role="status">
        Loading event…
      </p>
    );
  }

  if (error && !event) {
    return (
      <section className="empty-state">
        <p role="alert">
          {error}
        </p>

        <Link to="/events">
          Back to events
        </Link>
      </section>
    );
  }

  if (!event) return null;

  const steps = [
    {
      name: 'Created',
      person: event.device_name,
      time: event.created_at,
      done: true,
    },
    {
      name: 'Assigned',
      person: event.assigned_to_name,
      time: null,
      done: !!event.assigned_to_id,
    },
    {
      name: 'Acknowledged',
      person: event.acknowledged_by_name,
      time: event.acknowledged_at,
      done: !!event.acknowledged_at,
    },
    {
      name: 'Resolved',
      person: event.resolved_by_name,
      time: event.resolved_at,
      done: !!event.resolved_at,
    },
  ];

  return (
    <section className="event-detail-page">
      {connectionState === 'reconnecting' && (
        <p
          className="stream-warning"
          role="status"
        >
          Live updates interrupted. Reconnecting…
        </p>
      )}

      <Link
        className="back-link"
        to="/events"
      >
        ← Back to events
      </Link>

      <header className="event-hero">
        <div>
          <p className="eyebrow">
            EVENT DETAIL
          </p>

          <h2>
            {event.type.replaceAll('_', ' ')}
          </h2>

          <p>
            <Link
              to={`/devices/${event.device_id}`}
            >
              {event.device_name}
            </Link>

            <span>
              ⌖ {event.device_location}
            </span>

            <time>
              {new Date(
                event.created_at,
              ).toLocaleString()}
            </time>
          </p>
        </div>

        <EventStatus
          status={event.status}
        />
      </header>

      {error && (
        <p role="alert">
          {error}
        </p>
      )}

      <div className="event-detail-layout">
        <main>
          <section className="detail-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  PROGRESS
                </p>

                <h3>
                  Incident lifecycle
                </h3>
              </div>
            </div>

            <ol className="event-timeline">
              {steps.map((step) => (
                <li
                  key={step.name}
                  className={
                    step.done
                      ? 'complete'
                      : ''
                  }
                >
                  <i />

                  <div>
                    <strong>
                      {step.name}
                    </strong>

                    <span>
                      {step.person ??
                        'Pending'}
                    </span>

                    {step.time && (
                      <time>
                        {new Date(
                          step.time,
                        ).toLocaleString()}
                      </time>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="prose-grid">
            <article>
              <p className="eyebrow">
                RESPONDER INSTRUCTIONS
              </p>

              <div>
                {event.instructions ??
                  'No instructions provided.'}
              </div>
            </article>

            <article>
              <p className="eyebrow">
                COMPLETION NOTE
              </p>

              <div>
                {event.completion_note ??
                  'No completion note.'}
              </div>
            </article>
          </section>
        </main>

        <aside className="event-side">
          <section className="detail-panel assignment-summary">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  ASSIGNMENT
                </p>

                <h3>
                  {event.assigned_to_name ??
                    'Unassigned'}
                </h3>
              </div>
            </div>

            <p>
              {event.assigned_by_name
                ? `Assigned by ${event.assigned_by_name}`
                : 'No responder has been assigned.'}
            </p>

            {canAssign && (
              <EventAssignmentEditor
                event={event}
                responders={responders}
                onUpdated={setEvent}
              />
            )}
          </section>

          <EventSnapshot event={event} />
        </aside>
      </div>

      <section className="event-resolution-actions">
        {event.status ===
          'ACKNOWLEDGED' && (
          <label>
            Completion note (optional)

            <textarea
              value={note}
              onChange={(e) =>
                setNote(e.target.value)
              }
              maxLength={1000}
              rows={4}
            />
          </label>
        )}

        {event.status !== 'RESOLVED' && (
          <button
            disabled={updating}
            onClick={() =>
              void advance()
            }
          >
            {updating
              ? 'Updating…'
              : event.status === 'OPEN'
                ? 'Acknowledge event'
                : 'Resolve event'}
          </button>
        )}
      </section>
    </section>
  );
}