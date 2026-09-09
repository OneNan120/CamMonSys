import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listDevices, type DeviceSummary } from './device-api';

export function DeviceListPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

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

  return (
    <section>
      <h1>Devices</h1>

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
  );
}