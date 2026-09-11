import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getEvent, updateEventStatus, type MonitoringEvent } from '../devices/event-api';
import type { ResponderSummary } from '../responders/responder-api';
import { EventAssignmentEditor } from './EventAssignmentEditor';

export function EventStatus({ status }: { status: MonitoringEvent['status'] }) {
  return <span className={`event-status status-${status.toLowerCase()}`}><i />{status === 'ACKNOWLEDGED' ? 'Acked' : status[0] + status.slice(1).toLowerCase()}</span>;
}

export function EventCard({ event, defaultOpen = false, canAssign = false, responders = [] }: { event: MonitoringEvent; defaultOpen?: boolean; canAssign?: boolean; responders?: ResponderSummary[] }) {
  const [current, setCurrent] = useState(event);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setCurrent(event), [event]);
  const advance = async () => {
    if (current.status === 'RESOLVED' || busy) return;
    setBusy(true); setError('');
    try {
      await updateEventStatus(current.id, current.status === 'OPEN' ? 'ACKNOWLEDGED' : 'RESOLVED');
      setCurrent((await getEvent(current.id)).event);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update event.'); }
    finally { setBusy(false); }
  };
  event = current;
  return (
    <article className="event-card interactive-card">
      <div className="event-card-top">
        <div><Link className="event-title" to={`/events/${event.id}`}>{event.type.replaceAll('_', ' ')}</Link><p><Link to={`/devices/${event.device_id}`}>{event.device_name}</Link> · {event.device_location}</p></div>
        <EventStatus status={event.status} />
      </div>
      <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
      <details open={defaultOpen}>
        <summary>Event details</summary>
        <dl className="detail-list">
          <div><dt>Assigned to</dt><dd>{event.assigned_to_name ?? 'Unassigned'}</dd></div>
          <div><dt>Assigned by</dt><dd>{event.assigned_by_name ?? '—'}</dd></div>
          <div><dt>Instructions</dt><dd>{event.instructions ?? '—'}</dd></div>
          <div><dt>Acknowledged by</dt><dd>{event.acknowledged_by_name ?? '—'}</dd></div>
          <div><dt>Acknowledged at</dt><dd>{event.acknowledged_at ? new Date(event.acknowledged_at).toLocaleString() : '—'}</dd></div>
          <div><dt>Resolved by</dt><dd>{event.resolved_by_name ?? '—'}</dd></div>
          <div><dt>Resolved at</dt><dd>{event.resolved_at ? new Date(event.resolved_at).toLocaleString() : '—'}</dd></div>
          <div><dt>Completion note</dt><dd>{event.completion_note ?? '—'}</dd></div>
        </dl>
        {canAssign && <EventAssignmentEditor event={event} responders={responders} onUpdated={setCurrent} />}
        {error && <p role="alert">{error}</p>}
        <div className="event-actions"><Link className="text-link" to={`/events/${event.id}`}>Open full event →</Link><span>{event.status !== 'RESOLVED' && <button type="button" disabled={busy} onClick={() => void advance()}>{busy ? 'Updating…' : event.status === 'OPEN' ? 'Acknowledge' : 'Resolve'}</button>}</span></div>
      </details>
    </article>
  );
}
