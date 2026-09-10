import { useEffect, useState, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDevice, type DeviceSummary } from './device-api';
import { CameraViewer } from './CameraViewer';
import { listEvents, type MonitoringEvent } from './event-api';


export function DeviceDetailPage({ canPublish, }: { canPublish: boolean; }) {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const [events, setEvents] = useState<MonitoringEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState('');
  const [eventsRefreshError, setEventsRefreshError] = useState('');
  const eventsRequestId = useRef(0);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setDevice(null);
    setError('');

    if (!deviceId) {
      setError('Missing device ID.');
      setLoading(false);
      return;
    }

    getDevice(deviceId)
      .then(({ device }) => {
        if (active) setDevice(device);
      })
      .catch((error: unknown) => {
        if (!active) return;

        setError(
          error instanceof Error
            ? error.message
            : 'Unable to load device.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deviceId, attempt]);

  useEffect(() => {
    let active = true;

    setEventsLoading(true);
    setEventsError('');
    setEventsRefreshError('');

    if (!deviceId) {
      setEvents([]);
      setEventsLoading(false);
      return;
    }

    const requestId = ++eventsRequestId.current;

    listEvents(deviceId)
      .then(({ events }) => {
        if (active && requestId === eventsRequestId.current) {
          setEvents(events);
        }
      })
      .catch(() => {
        if (active && requestId === eventsRequestId.current) {
          setEventsError('Unable to load this device’s event history.');
        }
      })
      .finally(() => {
        if (active && requestId === eventsRequestId.current) {
          setEventsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [deviceId, attempt]);

  useEffect(() => {
    if (!deviceId || loading || error) return;

    let active = true;
    let refreshing = false;
    let refreshAgain = false;
    let eventsRefreshing = false;
    let refreshEventsAgain = false;

    const source = new EventSource('/api/stream');

    async function refreshDevice() {
      if (!active) return;

      if (refreshing) {
        refreshAgain = true;
        return;
      }

      refreshing = true;

      try {
        const result = await getDevice(deviceId!);

        if (active) {
          setDevice(result.device);
          setRefreshError('');
        }
      } catch {
        if (active) {
          setRefreshError(
            'Unable to refresh device status. Displayed data may be outdated.',
          );
        }
      } finally {
        refreshing = false;

        if (active && refreshAgain) {
          refreshAgain = false;
          void refreshDevice();
        }
      }
    }

    async function refreshEvents() {
      if (!active) return;

      if (eventsRefreshing) {
        refreshEventsAgain = true;
        return;
      }

      eventsRefreshing = true;
      const requestId = ++eventsRequestId.current;

      try {
        const result = await listEvents(deviceId);

        if (active && requestId === eventsRequestId.current) {
          setEvents(result.events);
          setEventsLoading(false);
          setEventsError('');
          setEventsRefreshError('');
        }
      } catch {
        if (active) {
          setEventsRefreshError(
            'Unable to refresh event history. Displayed data may be outdated.',
          );
        }
      } finally {
        eventsRefreshing = false;

        if (active && refreshEventsAgain) {
          refreshEventsAgain = false;
          void refreshEvents();
        }
      }
    }

    source.addEventListener('devices-changed', () => {
      void refreshDevice();
    });

    source.addEventListener('events-changed', () => {
      void refreshEvents();
    });

    source.onerror = () => {
      if (active) {
        setRefreshError(
          'Live updates disconnected. Reconnecting; displayed data may be outdated.',
        );
      }
    };

    source.addEventListener('access-ended', () => {
      active = false;
      source.close();
      setRefreshError('Your monitoring access ended. Sign in again.');
      setDevice(null);
      setEvents([]);
    });

  return () => {
    active = false;
    source.close();
  };
}, [deviceId, loading, error]);

  return (
    <section>
      <Link to="/">Back to devices</Link>
      {refreshError && <p role="alert">{refreshError}</p>}

      {loading ? (
        <p role="status">Loading device…</p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : device ? (
        <>
          <h1>{device.name}</h1>
          <p>{device.location}</p>
          <p>
            Status: {device.status === 'ONLINE' ? 'Online' : 'Offline'}
          </p>
          <p>
            Last seen:{' '}
            {device.last_seen_at
              ? new Date(device.last_seen_at).toLocaleString()
              : 'Never'}
          </p>
          {canPublish && (
            <p>
              <Link to={`/devices/${device.id}/camera`}>
                Open camera controls
              </Link>
            </p>
          )}
          <CameraViewer 
            key={device.id} 
            deviceId={device.id} 
            online={device.status === 'ONLINE'}
            streamVersion={device.stream_version}
          />

          <section aria-labelledby="device-events-heading">
            <h2 id="device-events-heading">Event history</h2>

            {eventsRefreshError && <p role="alert">{eventsRefreshError}</p>}

            {eventsLoading ? (
              <p role="status">Loading event history…</p>
            ) : eventsError ? (
              <p role="alert">{eventsError}</p>
            ) : events.length === 0 ? (
              <p>No monitoring events for this device yet.</p>
            ) : (
              <ul>
                {events.map((event) => (
                  <li key={event.id}>
                    <p>
                      <strong>{event.type.replaceAll('_', ' ')}</strong>
                      {' · '}
                      {event.status}
                    </p>

                    <p>{new Date(event.created_at).toLocaleString()}</p>

                    {event.acknowledged_at && (
                      <p>
                        Acknowledged by{' '}
                        {event.acknowledged_by_name ?? 'Unknown user'}
                        {' on '}
                        {new Date(event.acknowledged_at).toLocaleString()}
                      </p>
                    )}

                    {event.resolved_at && (
                      <p>
                        Resolved by {event.resolved_by_name ?? 'Unknown user'}
                        {' on '}
                        {new Date(event.resolved_at).toLocaleString()}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}