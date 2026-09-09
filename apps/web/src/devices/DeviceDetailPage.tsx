import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDevice, type DeviceSummary } from './device-api';

export function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

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

  return (
    <section>
      <Link to="/">Back to devices</Link>

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
          <p>Camera viewing will be added next.</p>
        </>
      ) : null}
    </section>
  );
}