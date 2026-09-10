import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDevice, type DeviceSummary } from './device-api';
import { CameraPage } from './CameraPage';

export function CameraDevicePage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
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

  if (loading) {
    return <p role="status">Loading device…</p>;
  }

  if (error) {
    return (
      <section>
        <p role="alert">{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
        <Link to="/">Back to devices</Link>
      </section>
    );
  }

  if (!device || device.id !== deviceId) return null;

  return (
    <section>
      <Link to={`/devices/${device.id}`}>Back to device</Link>
      <p>{device.name} · {device.location}</p>
      <CameraPage key={device.id} deviceId={device.id} />
    </section>
  );
}