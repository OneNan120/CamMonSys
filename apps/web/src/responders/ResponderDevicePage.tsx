import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api';
import { CameraViewer } from '../devices/CameraViewer';
import {
  getDevice,
  type DeviceSummary,
} from '../devices/device-api';

export function ResponderDevicePage() {
  const { deviceId } = useParams<{ deviceId: string }>();

  const [device, setDevice] = useState<DeviceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    let refreshAgain = false;

    if (!deviceId) {
      setError('Missing device ID.');
      setLoading(false);
      return;
    }
    const activeDeviceId = deviceId;

    setLoading(true);
    setError('');
    setRefreshError('');

    async function refreshDevice(initialLoad = false) {
      if (!active) return;

      if (refreshing) {
        refreshAgain = true;
        return;
      }

      refreshing = true;

      try {
        const result = await getDevice(activeDeviceId);

        if (active) {
          setDevice(result.device);
          setError('');
          setRefreshError('');
        }
      } catch (error: unknown) {
        if (!active) return;

        if (error instanceof ApiError && error.status === 403) {
          setDevice(null);
          setError(
            'This assignment ended or was reassigned. You no longer have access to this camera.',
          );
        } else if (initialLoad) {
          setDevice(null);
          setError(
            error instanceof Error
              ? error.message
              : 'Unable to load the assigned device.',
          );
        } else {
          setRefreshError(
            'Unable to refresh the camera status. Displayed data may be outdated.',
          );
        }
      } finally {
        refreshing = false;

        if (active && initialLoad) {
          setLoading(false);
        }

        if (active && refreshAgain) {
          refreshAgain = false;
          void refreshDevice();
        }
      }
    }

    void refreshDevice(true);

    const source = new EventSource('/api/stream');

    source.addEventListener('devices-changed', () => {
      void refreshDevice();
    });

    source.addEventListener('events-changed', () => {
      // Recheck authorization after resolution, unassignment, or reassignment.
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
      setDevice(null);
      setError('Your monitoring access ended. Sign in again.');
      setLoading(false);
    });

    return () => {
      active = false;
      source.close();
    };
  }, [deviceId, attempt]);

  return (
    <section aria-labelledby="assigned-camera-heading">
      <Link to="/">Back to my assignments</Link>

      <h1 id="assigned-camera-heading">
        {device?.name ?? 'Assigned camera'}
      </h1>

      {refreshError && <p role="alert">{refreshError}</p>}

      {loading ? (
        <p role="status">Loading assigned camera…</p>
      ) : error ? (
        <div>
          <p role="alert">{error}</p>

          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : device ? (
        <>
          <p>Location: {device.location}</p>
          <p>
            Status: {device.status === 'ONLINE' ? 'Online' : 'Offline'}
          </p>
          <p>
            Last seen:{' '}
            {device.last_seen_at
              ? new Date(device.last_seen_at).toLocaleString()
              : 'Never'}
          </p>

          <CameraViewer
            deviceId={device.id}
            online={device.status === 'ONLINE'}
            streamVersion={device.stream_version}
          />
        </>
      ) : null}
    </section>
  );
}