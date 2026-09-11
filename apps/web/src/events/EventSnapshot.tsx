import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  eventSnapshotUrl,
  type MonitoringEvent,
} from '../devices/event-api';

export function EventSnapshot({
  event,
  linkToEvent = false,
  heading = 'Event snapshot',
}: {
  event: MonitoringEvent;
  linkToEvent?: boolean;
  heading?: string;
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>(
    event.snapshot_available ? 'loading' : 'error',
  );

  useEffect(() => {
    setState(event.snapshot_available ? 'loading' : 'error');
  }, [event.id, event.snapshot_available, event.snapshot_captured_at]);

  const title = linkToEvent ? (
    <Link to={`/events/${event.id}`}>{heading}</Link>
  ) : (
    heading
  );

  if (!event.snapshot_available) {
    return (
      <section className="snapshot-panel snapshot-panel--empty">
        <span aria-hidden="true">▧</span>
        <h3>{title}</h3>
        <p>No snapshot was captured for this event.</p>
      </section>
    );
  }

  return (
    <section className="snapshot-panel">
      <div className="snapshot-heading">
        <div>
          <p className="eyebrow">SNAPSHOT</p>
          <h3>{title}</h3>
        </div>
        {event.snapshot_captured_at && (
          <time dateTime={event.snapshot_captured_at}>
            {new Date(event.snapshot_captured_at).toLocaleString()}
          </time>
        )}
      </div>

      <div className="snapshot-image-frame">
        {state === 'loading' && <p role="status">Loading snapshot…</p>}
        <img
          src={eventSnapshotUrl(event.id)}
          alt={`Snapshot from ${event.device_name} for ${event.type.replaceAll('_', ' ')}`}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
          hidden={state === 'error'}
        />
        {state === 'error' && (
          <p role="alert">Snapshot is unavailable or you no longer have access.</p>
        )}
      </div>
    </section>
  );
}
