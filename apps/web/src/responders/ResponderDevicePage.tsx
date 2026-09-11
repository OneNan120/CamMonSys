import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ApiError } from '../api';
import { CameraViewer } from '../devices/CameraViewer';
import {
  getDevice,
  type DeviceSummary,
} from '../devices/device-api';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';
import {
  listMyAssignments,
  type MonitoringEvent,
} from '../devices/event-api';
import { EventSnapshot } from '../events/EventSnapshot';

export function ResponderDevicePage() {
  const {
    deviceRevision,
    eventRevision,
    connectionState,
  } = useMonitoringStream();

  const { deviceId } = useParams<{
    deviceId: string;
  }>();

  const [searchParams] = useSearchParams();
  const selectedEventId = searchParams.get('eventId');

  const [device, setDevice] =
    useState<DeviceSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] =
    useState('');
  const [attempt, setAttempt] = useState(0);
  const [assignedEvents, setAssignedEvents] = useState<MonitoringEvent[]>([]);
  const [eventsError, setEventsError] = useState('');

  useEffect(() => {
    let active = true;

    if (!deviceId) {
      setError('Missing device ID.');
      setLoading(false);
      return;
    }

    setLoading((current) =>
      device === null ? true : current,
    );

    setRefreshError('');

    getDevice(deviceId)
      .then(({ device }) => {
        if (active) {
          setDevice(device);
          setError('');
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;

        if (
          caught instanceof ApiError &&
          caught.status === 403
        ) {
          setDevice(null);
          setError(
            'This assignment ended or was reassigned. You no longer have access to this camera.',
          );
        } else if (device) {
          setRefreshError(
            'Unable to refresh the camera status. Displayed data may be outdated.',
          );
        } else {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to load the assigned device.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    deviceId,
    attempt,
    deviceRevision,
    eventRevision,
  ]);

  useEffect(() => {
    let active = true;

    if (!deviceId) {
      setAssignedEvents([]);
      return;
    }

    listMyAssignments()
      .then(({ events }) => {
        if (active) {
          setAssignedEvents(
            events.filter((event) => event.device_id === deviceId),
          );
          setEventsError('');
        }
      })
      .catch(() => {
        if (active) {
          setEventsError(
            'Unable to refresh snapshots for this assignment.',
          );
        }
      });

    return () => {
      active = false;
    };
  }, [deviceId, eventRevision, attempt]);

  const selectedEvent = selectedEventId
    ? assignedEvents.find((event) => event.id === selectedEventId)
    : assignedEvents.length === 1
      ? assignedEvents[0]
      : undefined;

  return (
    <section aria-labelledby="assigned-camera-heading">
      {connectionState === 'reconnecting' && (
        <p className="stream-warning">
          Live updates interrupted. Reconnecting…
        </p>
      )}

      <Link to="/">
        Back to my assignments
      </Link>

      <h1 id="assigned-camera-heading">
        {device?.name ?? 'Assigned camera'}
      </h1>

      {refreshError && (
        <p role="alert">
          {refreshError}
        </p>
      )}

      {loading ? (
        <p role="status">
          Loading assigned camera…
        </p>
      ) : error ? (
        <div>
          <p role="alert">
            {error}
          </p>

          <button
            type="button"
            onClick={() =>
              setAttempt(
                (value) => value + 1,
              )
            }
          >
            Retry
          </button>
        </div>
      ) : device ? (
        <>
          <p>
            Location: {device.location}
          </p>

          <p>
            Status:{' '}
            {device.status === 'ONLINE'
              ? 'Online'
              : 'Offline'}
          </p>

          <p>
            Last seen:{' '}
            {device.last_seen_at
              ? new Date(
                  device.last_seen_at,
                ).toLocaleString()
              : 'Never'}
          </p>

          <CameraViewer
            deviceId={device.id}
            online={
              device.status === 'ONLINE'
            }
            streamVersion={
              device.stream_version
            }
          />

          {eventsError && (
            <p role="alert">{eventsError}</p>
          )}

          {selectedEvent ? (
            <EventSnapshot
              event={selectedEvent}
              linkToEvent
              heading="Assigned event snapshot"
            />
          ) : (
            <section className="snapshot-panel snapshot-panel--empty">
              <span aria-hidden="true">▧</span>
              <h2>Assigned event snapshot</h2>
              <p>
                {selectedEventId
                  ? 'That event is no longer an active assignment for this device.'
                  : 'Open this camera from a specific assignment to view that event’s snapshot.'}
              </p>
            </section>
          )}
        </>
      ) : null}
    </section>
  );
}