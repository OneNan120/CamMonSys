import { useEffect, useState, useRef } from 'react';
import {
  Link,
  useParams,
  useNavigate,
} from 'react-router-dom';

import {
  getDevice,
  type DeviceSummary,
  deleteDevice,
  updateDeviceGroup,
} from './device-api';
import {
  listDeviceGroups,
  type DeviceGroup,
} from '../device-groups/device-group-api';
import { CameraViewer } from './CameraViewer';
import {
  listEvents,
  type MonitoringEvent,
} from './event-api';
import { EventCard } from '../events/EventCard';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';
import {
  listResponders,
  type ResponderSummary,
} from '../responders/responder-api';
import { ApiError } from '../api';

export function DeviceDetailPage({
  canPublish,
  canDelete,
  canManageGroups,
}: {
  canPublish: boolean;
  canDelete: boolean;
  canManageGroups: boolean;
}) {
  const {
    deviceRevision,
    eventRevision,
    connectionState,
  } = useMonitoringStream();

  const navigate = useNavigate();

  const { deviceId } = useParams<{
    deviceId: string;
  }>();

  const [responders, setResponders] = useState<
    ResponderSummary[]
  >([]);

  const [device, setDevice] =
    useState<DeviceSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState('');

  const [events, setEvents] = useState<
    MonitoringEvent[]
  >([]);

  const [eventsLoading, setEventsLoading] =
    useState(true);

  const [eventsError, setEventsError] =
    useState('');

  const [
    eventsRefreshError,
    setEventsRefreshError,
  ] = useState('');

  const eventsRequestId = useRef(0);
  const groupsRequestId = useRef(0);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [groups, setGroups] =
    useState<DeviceGroup[]>([]);

  const [groupsLoading, setGroupsLoading] =
    useState(true);

  const [groupsError, setGroupsError] =
    useState('');

  const [updatingGroup, setUpdatingGroup] =
    useState(false);

  const [groupActionError, setGroupActionError] =
    useState('');

  useEffect(() => {
    let active = true;

    setLoading(device === null);
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

        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load device.';

        if (device) {
          setRefreshError(
            'Unable to refresh device status. Displayed data may be outdated.',
          );
        } else {
          setError(message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [deviceId, attempt, deviceRevision]);

  useEffect(() => {
    let active = true;

    setGroupsLoading(true);
    setGroupsError('');

    const requestId = ++groupsRequestId.current;

    listDeviceGroups()
      .then(({ groups }) => {
        if (
          active &&
          requestId === groupsRequestId.current
        ) {
          setGroups(groups);
        }
      })
      .catch(() => {
        if (
          active &&
          requestId === groupsRequestId.current
        ) {
          setGroupsError(
            'Unable to load device groups.',
          );
        }
      })
      .finally(() => {
        if (
          active &&
          requestId === groupsRequestId.current
        ) {
          setGroupsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, deviceRevision]);

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
        if (
          active &&
          requestId === eventsRequestId.current
        ) {
          setEvents(events);
        }
      })
      .catch(() => {
        if (
          active &&
          requestId === eventsRequestId.current
        ) {
          setEventsError(
            'Unable to load this device’s event history.',
          );
        }
      })
      .finally(() => {
        if (
          active &&
          requestId === eventsRequestId.current
        ) {
          setEventsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [deviceId, attempt, eventRevision]);

  useEffect(() => {
    let active = true;

    listResponders()
      .then(
        ({ responders }) =>
          active && setResponders(responders),
      )
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [eventRevision]);

  async function handleDeviceGroup(
    groupId: string | null,
  ) {
    if (!device || updatingGroup) return;

    setUpdatingGroup(true);
    setGroupActionError('');

    try {
      const result = await updateDeviceGroup(
        device.id,
        groupId,
      );

      setDevice((currentDevice) =>
        currentDevice
          ? {
              ...currentDevice,
              group_id: result.device.group_id,
            }
          : currentDevice,
      );
    } catch (error: unknown) {
      setGroupActionError(
        error instanceof Error
          ? error.message
          : 'Unable to update the device group.',
      );
    } finally {
      setUpdatingGroup(false);
    }
  }

  async function handleDeleteDevice() {
    if (!device || deleting) return;

    const confirmed = window.confirm(
      `Delete ${device.name}? Its history will be preserved.`,
    );

    if (!confirmed) return;

    setDeleting(true);
    setDeleteError('');

    try {
      await deleteDevice(device.id);

      navigate('/devices', {
        replace: true,
      });
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError &&
          error.status === 409
          ? 'Resolve all events for this device before deleting it.'
          : error instanceof Error
            ? error.message
            : 'Unable to delete the device.',
      );

      setDeleting(false);
    }
  }

  return (
    <section className="device-detail-page">
      {connectionState === 'reconnecting' && (
        <p
          className="stream-warning"
          role="status"
        >
          Live updates interrupted. Reconnecting…
        </p>
      )}

      <Link
        className="back-link"
        to="/devices"
      >
        ← Back to devices
      </Link>

      {refreshError && (
        <p role="alert">{refreshError}</p>
      )}

      {loading ? (
        <p role="status">Loading device…</p>
      ) : error ? (
        <div className="empty-state">
          <p role="alert">{error}</p>

          <button
            onClick={() =>
              setAttempt((v) => v + 1)
            }
          >
            Retry
          </button>
        </div>
      ) : device ? (
        <>
          <section className="device-camera-panel">
            <header>
              <div>
                <p className="eyebrow">
                  LIVE CAMERA
                </p>

                <h2>{device.name}</h2>

                <p>⌖ {device.location}</p>
              </div>

              <span
                className={`device-state ${device.status.toLowerCase()}`}
              >
                <i />
                {device.status}
              </span>
            </header>

            <div className="camera-output">
              <CameraViewer
                key={device.id}
                deviceId={device.id}
                online={
                  device.status === 'ONLINE'
                }
                streamVersion={
                  device.stream_version
                }
              />
            </div>

            <footer>
              <span>
                Last seen{' '}
                {device.last_seen_at
                  ? new Date(
                      device.last_seen_at,
                    ).toLocaleString()
                  : 'Never'}
              </span>

              {canPublish && (
                <Link
                  className="link-button"
                  to={`/devices/${device.id}/camera`}
                >
                  Open Camera Controls
                </Link>
              )}
            </footer>
          </section>

          <section
            className="device-management-panel"
            aria-label="Device management"
          >
            <div>
              <p className="eyebrow">
                DEVICE SETTINGS
              </p>

              {canManageGroups ? (
                <label htmlFor="detail-device-group">
                  Device group

                  <select
                    id="detail-device-group"
                    value={device.group_id ?? ''}
                    disabled={
                      groupsLoading ||
                      Boolean(groupsError) ||
                      updatingGroup
                    }
                    onChange={(e) =>
                      void handleDeviceGroup(
                        e.target.value || null,
                      )
                    }
                  >
                    <option value="">
                      {groupsLoading
                        ? 'Loading groups…'
                        : 'Ungrouped'}
                    </option>

                    {device.group_id &&
                      !groups.some(
                        (g) =>
                          g.id ===
                          device.group_id,
                      ) && (
                        <option
                          value={device.group_id}
                        >
                          Unknown group
                        </option>
                      )}

                    {groups.map((g) => (
                      <option
                        key={g.id}
                        value={g.id}
                      >
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p>
                  Group:{' '}
                  {device.group_id
                    ? groups.find(
                        (g) =>
                          g.id ===
                          device.group_id,
                      )?.name ??
                      'Unknown group'
                    : 'Ungrouped'}
                </p>
              )}

              {updatingGroup && (
                <p role="status">
                  Updating group…
                </p>
              )}

              {groupsError && (
                <p role="alert">
                  {groupsError}
                </p>
              )}

              {groupActionError && (
                <p role="alert">
                  {groupActionError}
                </p>
              )}
            </div>

            {canDelete && (
              <div className="danger-zone">
                <div>
                  <strong>
                    Delete device
                  </strong>

                  <small>
                    Event and audit history will
                    be preserved.
                  </small>
                </div>

                <button
                  type="button"
                  className="danger-button"
                  disabled={deleting}
                  onClick={() =>
                    void handleDeleteDevice()
                  }
                >
                  {deleting
                    ? 'Deleting…'
                    : 'Delete device'}
                </button>

                {deleteError && (
                  <p role="alert">
                    {deleteError}
                  </p>
                )}
              </div>
            )}
          </section>

          <section
            className="device-event-history"
            aria-labelledby="device-events-heading"
          >
            <div className="section-heading">
              <h2 id="device-events-heading">
                Event history
              </h2>

              <Link
                to={`/events?deviceId=${device.id}`}
              >
                View all
              </Link>
            </div>

            {eventsRefreshError && (
              <p role="alert">
                {eventsRefreshError}
              </p>
            )}

            {eventsLoading ? (
              <p role="status">
                Loading event history…
              </p>
            ) : eventsError ? (
              <p role="alert">
                {eventsError}
              </p>
            ) : events.length === 0 ? (
              <p className="empty-panel">
                No monitoring events for this
                device yet.
              </p>
            ) : (
              <div className="event-history-list">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    canAssign
                    responders={responders}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}