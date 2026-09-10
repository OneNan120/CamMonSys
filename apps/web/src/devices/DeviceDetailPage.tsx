import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getDevice, type DeviceSummary } from './device-api';
import { CameraViewer } from './CameraViewer';


export function DeviceDetailPage({ canPublish, }: { canPublish: boolean; }) {
  const { deviceId } = useParams<{ deviceId: string }>();
  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState('');

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
    if (!deviceId || loading || error) return;

    let active = true;
    let refreshing = false;
    let refreshAgain = false;

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

    source.addEventListener('devices-changed', () => {
      void refreshDevice();
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
        </>
      ) : null}
    </section>
  );
}