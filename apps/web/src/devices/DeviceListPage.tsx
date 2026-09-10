import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDevices, type DeviceSummary } from './device-api';
import { listEvents, type MonitoringEvent } from './event-api';

export function DeviceListPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const [events, setEvents] = useState<MonitoringEvent[]>([]);
  const [eventsError, setEventsError] = useState('');

  useEffect(() => {
    let active = true;

    listEvents()
      .then(({ events }) => {
        if (active) {
          setEvents(events);
          setEventsError('');
        }
      })
      .catch(() => {
        if (active) {
          setEventsError('Unable to load monitoring events.');
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

    listDevices()
      .then(({ devices }) => {
        if (active) setDevices(devices);
      })
      .catch((error: unknown) => {
        if (!active) return;

        setError(
          error instanceof Error
            ? error.message
            : 'Unable to load devices.',
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (loading || error) return;

    let active = true;
    let refreshing = false;
    let refreshAgain = false;

    const source = new EventSource('/api/stream');

    async function refreshDevices() {
      if (!active) return;

      if (refreshing) {
        refreshAgain = true;
        return;
      }

      refreshing = true;

      try {
        const result = await listDevices();

        if (active) {
          setDevices(result.devices);
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
          void refreshDevices();
        }
      }
    }

    async function refreshEvents() {
      try {
        const result = await listEvents();

        if (active) {
          setEvents(result.events);
          setEventsError('');
        }
      } catch {
        if (active) {
          setEventsError(
            'Unable to refresh monitoring events. Displayed data may be outdated.',
          );
        }
      }
    }

    source.addEventListener('devices-changed', () => {
      void refreshDevices();
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
      setDevices([]);
      setEvents([]);
    });

    return () => {
      active = false;
      source.close();
    };
  }, [loading, error]);

  return (
    <>
    <section>
      <h1>Devices</h1>
      {refreshError && <p role="alert">{refreshError}</p>}

      {loading ? (
        <p role="status">Loading devices…</p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>
          <button onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </button>
        </div>
      ) : devices.length === 0 ? (
        <p>No devices have been registered yet.</p>
      ) : (
        <ul>
          {devices.map((device) => (
            <li key={device.id}>
              <h2>
                <Link to={`/devices/${device.id}`}>{device.name}</Link>
            </h2>
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
            </li>
          ))}
        </ul>
      )}
    </section>
    <section aria-labelledby="recent-events-heading">
      <h2 id="recent-events-heading">Recent events</h2>

      {eventsError && <p role="alert">{eventsError}</p>}

      {events.length === 0 ? (
        <p>No monitoring events yet.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              <p>
                <strong>{event.type.replaceAll('_', ' ')}</strong>
                {' · '}
                {event.status}
              </p>

              <p>
                <Link to={`/devices/${event.device_id}`}>
                  {event.device_name}
                </Link>
                {' · '}
                {event.device_location}
              </p>

              <p>{new Date(event.created_at).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
    </>
  );
}
