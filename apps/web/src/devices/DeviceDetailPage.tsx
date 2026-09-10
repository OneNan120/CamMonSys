import { useEffect, useState, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { getDevice, type DeviceSummary, deleteDevice, updateDeviceGroup } from './device-api';
import { listDeviceGroups, type DeviceGroup, } from '../device-groups/device-group-api';
import { CameraViewer } from './CameraViewer';
import { listEvents, type MonitoringEvent, updateEventStatus } from './event-api';
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
  const navigate = useNavigate();
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
  const groupsRequestId = useRef(0);
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const [eventActionError, setEventActionError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState('');
  const [updatingGroup, setUpdatingGroup] = useState(false);
  const [groupActionError, setGroupActionError] = useState('');

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
          setGroupsError('Unable to load device groups.');
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
  }, [attempt]);

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
    let groupsRefreshing = false;
    let refreshGroupsAgain = false;

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

    async function refreshGroups() {
      if (!active) return;

      if (groupsRefreshing) {
        refreshGroupsAgain = true;
        return;
      }

      groupsRefreshing = true;
      const requestId = ++groupsRequestId.current;

      try {
        const result = await listDeviceGroups();

        if (
          active &&
          requestId === groupsRequestId.current
        ) {
          setGroups(result.groups);
          setGroupsLoading(false);
          setGroupsError('');
        }
      } catch {
        if (active) {
          setGroupsError(
            'Unable to refresh device groups. Displayed groups may be outdated.',
          );
        }
      } finally {
        groupsRefreshing = false;

        if (active && refreshGroupsAgain) {
          refreshGroupsAgain = false;
          void refreshGroups();
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
      void refreshGroups();
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
      setGroups([]);
    });

    return () => {
      active = false;
      source.close();
    };
  }, [deviceId, loading, error]);

  async function handleDeviceGroup(groupId: string | null) {
    if (!device || updatingGroup) return;

    setUpdatingGroup(true);
    setGroupActionError('');

    try {
      const result = await updateDeviceGroup(device.id, groupId);

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
      navigate('/', { replace: true });
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError && error.status === 409
          ? 'Resolve all events for this device before deleting it.'
          : error instanceof Error
            ? error.message
            : 'Unable to delete the device.',
      );

      setDeleting(false);
    }
  }

  async function handleEventStatus(
    eventId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED',
  ) {
    if (!deviceId || updatingEventId) return;

    setUpdatingEventId(eventId);
    setEventActionError('');

    try {
      await updateEventStatus(eventId, status);
    } catch (error: unknown) {
      setEventActionError(
        error instanceof ApiError && error.status === 409
          ? 'This event has changed. Review its latest status.'
          : error instanceof Error
            ? error.message
            : 'Unable to update the event.',
      );
    } finally {
      try {
        const result = await listEvents(deviceId);
        setEvents(result.events);
        setEventsError('');
        setEventsRefreshError('');
      } catch {
        setEventsRefreshError(
          'Unable to refresh event history. Displayed data may be outdated.',
        );
      }

      setUpdatingEventId(null);
    }
  }

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
          {canManageGroups ? (
            <div>
              <label htmlFor="detail-device-group">Device group</label>

              <select
                id="detail-device-group"
                value={device.group_id ?? ''}
                disabled={
                  groupsLoading ||
                  Boolean(groupsError) ||
                  updatingGroup
                }
                onChange={(event) =>
                  void handleDeviceGroup(event.target.value || null)
                }
              >
                <option value="">
                  {groupsLoading ? 'Loading groups…' : 'No group'}
                </option>

                {device.group_id &&
                  !groups.some((group) => group.id === device.group_id) && (
                    <option value={device.group_id}>Unknown group</option>
                  )}

                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>

              {updatingGroup && <p role="status">Updating group…</p>}
              {groupsError && <p role="alert">{groupsError}</p>}
              {groupActionError && <p role="alert">{groupActionError}</p>}
            </div>
          ) : (
            <p>
              Group:{' '}
              {device.group_id
                ? groups.find((group) => group.id === device.group_id)?.name ??
                  'Unknown group'
                : 'Ungrouped'}
            </p>
          )}
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
          {canDelete && (
            <div>
              {deleteError && <p role="alert">{deleteError}</p>}

              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDeleteDevice()}
              >
                {deleting ? 'Deleting…' : 'Delete device'}
              </button>
            </div>
          )}
          <CameraViewer 
            key={device.id} 
            deviceId={device.id} 
            online={device.status === 'ONLINE'}
            streamVersion={device.stream_version}
          />

          <section aria-labelledby="device-events-heading">
            <h2 id="device-events-heading">Event history</h2>

            {eventActionError && <p role="alert">{eventActionError}</p>}
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
                    {event.status !== 'RESOLVED' && (
                      <button
                        disabled={updatingEventId !== null}
                        onClick={() =>
                          void handleEventStatus(
                            event.id,
                            event.status === 'OPEN' ? 'ACKNOWLEDGED' : 'RESOLVED',
                          )
                        }
                      >
                        {updatingEventId === event.id
                          ? 'Updating…'
                          : event.status === 'OPEN'
                            ? 'Acknowledge'
                            : 'Resolve'}
                      </button>
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