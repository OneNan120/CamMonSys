import { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { listDevices, type DeviceSummary } from './device-api';
import { listEvents, type MonitoringEvent, updateEventStatus, updateEventAssignment } from './event-api';
import { listDeviceGroups, type DeviceGroup } from '../device-groups/device-group-api';
import { ApiError } from '../api';
import { listResponders, type ResponderSummary } from '../responders/responder-api';

const UNGROUPED_FILTER = '__ungrouped__';

export function DeviceListPage() {

  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState('');
  const [events, setEvents] = useState<MonitoringEvent[]>([]);
  const [eventsError, setEventsError] = useState('');
  const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
  const [eventActionError, setEventActionError] = useState('');
  const [deviceSearch, setDeviceSearch] = useState('');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [responders, setResponders] = useState<ResponderSummary[]>([]);
  const [respondersError, setRespondersError] = useState('');
  const [assignmentResponderIds, setAssignmentResponderIds] = useState<Record<string, string>>({});
  const [assignmentInstructions, setAssignmentInstructions] = useState<Record<string, string>>({});

  const [updatingAssignmentEventId, setUpdatingAssignmentEventId] =
    useState<string | null>(null);

  const groupsRequestId = useRef(0);
  const eventsRequestId = useRef(0);
  const eventsActive = useRef(true);

  async function refreshEventData() {
    if (!eventsActive.current) return;
    const requestId = ++eventsRequestId.current;
    try {
      const result = await listEvents();
      if (eventsActive.current && requestId === eventsRequestId.current) {
        setEvents(result.events);
        setEventsError('');
      }
    } catch {
      if (eventsActive.current && requestId === eventsRequestId.current) {
        setEventsError('Unable to refresh monitoring events. Displayed data may be outdated.');
      }
    }
  }

  function applyGroups(nextGroups: DeviceGroup[]) {
    setGroups(nextGroups);

    setSelectedGroupId((currentGroupId) => {
      if (
        !currentGroupId ||
        currentGroupId === UNGROUPED_FILTER
      ) {
        return currentGroupId;
      }

      const stillExists = nextGroups.some(
        (group) => group.id === currentGroupId,
      );

      return stillExists ? currentGroupId : '';
    });
  }

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
          applyGroups(groups);
        }
      })
      .catch(() => {
        if (active && requestId === groupsRequestId.current) {
          setGroupsError(
            'Unable to load device groups. Showing all devices.',
          );
          setSelectedGroupId('');
        }
      })
      .finally(() => {
        if (active && requestId === groupsRequestId.current) {
          setGroupsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    let active = true;

    listResponders()
      .then(({ responders }) => {
        if (active) {
          setResponders(responders);
          setRespondersError('');
        }
      })
      .catch(() => {
        if (active) {
          setRespondersError('Unable to load responders.');
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  useEffect(() => {
    eventsActive.current = true;
    void refreshEventData();

    return () => {
      eventsActive.current = false;
      eventsRequestId.current++;
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
    let groupsRefreshing = false;
    let refreshGroupsAgain = false;

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
          applyGroups(result.groups);
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
      if (active) await refreshEventData();
    }

    source.addEventListener('devices-changed', () => {
      void refreshDevices();
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
      eventsActive.current = false;
      eventsRequestId.current++;
      source.close();
      setRefreshError('Your monitoring access ended. Sign in again.');
      setDevices([]);
      setEvents([]);
      setGroups([]);
      setSelectedGroupId('');
    });

    return () => {
      active = false;
      source.close();
    };
  }, [loading, error]);

  async function handleEventAssignment(event: MonitoringEvent) {
    if (updatingAssignmentEventId) return;

    const responderId =
      assignmentResponderIds[event.id] ?? event.assigned_to_id ?? '';

    const instructions =
      assignmentInstructions[event.id] ?? event.instructions ?? '';

    setUpdatingAssignmentEventId(event.id);
    setEventActionError('');

    try {
      if (responderId) {
        await updateEventAssignment(event.id, {
          responderId,
          instructions: instructions.trim(),
        });
      } else {
        await updateEventAssignment(event.id, {
          responderId: null,
          instructions: null,
        });
      }

      await refreshEventData();

      setAssignmentResponderIds((current) => {
        const next = { ...current };
        delete next[event.id];
        return next;
      });

      setAssignmentInstructions((current) => {
        const next = { ...current };
        delete next[event.id];
        return next;
      });
    } catch (error: unknown) {
      setEventActionError(
        error instanceof ApiError && error.status === 409
          ? 'This event assignment has changed. Review the latest assignment.'
          : error instanceof Error
            ? error.message
            : 'Unable to update the assignment.',
      );

      try {
        await refreshEventData();
      } catch {
        setEventsError(
          'Unable to refresh events. Displayed data may be outdated.',
        );
      }
    } finally {
      setUpdatingAssignmentEventId(null);
    }
  }

  async function handleEventStatus(
    eventId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED',
  ) {
    if (updatingEventId) return;

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
      // Fetch after success or conflict; do not depend solely on SSE.
      try {
        await refreshEventData();
      } catch {
        setEventsError(
          'Unable to refresh events. Displayed data may be outdated.',
        );
      }

      setUpdatingEventId(null);
    }
  }

  const normalizedDeviceSearch = deviceSearch.trim().toLowerCase();

  const searchFilteredDevices = normalizedDeviceSearch
    ? devices.filter(
        (device) =>
          device.name.toLowerCase().includes(normalizedDeviceSearch) ||
          device.location.toLowerCase().includes(normalizedDeviceSearch),
      )
    : devices;

  const filteredDevices = searchFilteredDevices.filter((device) => {
    if (!selectedGroupId) {
      return true;
    }

    if (selectedGroupId === UNGROUPED_FILTER) {
      return device.group_id === null;
    }

    return device.group_id === selectedGroupId;
  });

  const groupNameById = new Map(
    groups.map((group) => [group.id, group.name]),
  );

  return (
    <>
    <section>
      <h1>Devices</h1>
      {refreshError && <p role="alert">{refreshError}</p>}

      <label>
        Search devices
        <input
          type="search"
          value={deviceSearch}
          onChange={(event) => setDeviceSearch(event.target.value)}
          placeholder="Search by name or location"
        />
      </label>

      <label>
        Device group
        <select
          value={selectedGroupId}
          onChange={(event) => setSelectedGroupId(event.target.value)}
          disabled={groupsLoading || Boolean(groupsError)}
        >
          <option value="">
            {groupsLoading ? 'Loading groups…' : 'All devices'}
          </option>

          <option value={UNGROUPED_FILTER}>Ungrouped</option>

          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name}
            </option>
          ))}
        </select>
      </label>

      {groupsError && <p role="alert">{groupsError}</p>}

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
        ) : filteredDevices.length === 0 ? (
          <p>No devices match the current search and group filters.</p>
        ) : (
          <ul>
            {filteredDevices.map((device) => (
            <li key={device.id}>
              <h2>
                <Link to={`/devices/${device.id}`}>{device.name}</Link>
            </h2>
              <p>{device.location}</p>
              <p>
                Group:{' '}
                {device.group_id
                  ? groupNameById.get(device.group_id) ?? 'Unknown group'
                  : 'Ungrouped'}
              </p>
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
      {eventActionError && <p role="alert">{eventActionError}</p>}
      {respondersError && <p role="alert">{respondersError}</p>}

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

            {event.acknowledged_at && (
              <p>
                Acknowledged by {event.acknowledged_by_name ?? 'Unknown user'}
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

            {event.assigned_to_id ? (
              <>
                <p>
                  Assigned to:{' '}
                  {event.assigned_to_name ??
                    responders.find(
                      (responder) => responder.id === event.assigned_to_id,
                    )?.name ??
                    'Unknown responder'}
                </p>

                {event.assigned_by_name && (
                  <p>Assigned by: {event.assigned_by_name}</p>
                )}

                {event.instructions && (
                  <p>Instructions: {event.instructions}</p>
                )}
              </>
            ) : (
              <p>Unassigned</p>
            )}

            {event.completion_note && (
              <p>Completion note: {event.completion_note}</p>
            )}

            {event.status !== 'RESOLVED' && (
              <fieldset disabled={updatingAssignmentEventId !== null}>
                <legend>Responder assignment</legend>

                <label>
                  Responder
                  <select
                    value={
                      assignmentResponderIds[event.id] ??
                      event.assigned_to_id ??
                      ''
                    }
                    onChange={(changeEvent) => {
                      const responderId = changeEvent.target.value;

                      setAssignmentResponderIds((current) => ({
                        ...current,
                        [event.id]: responderId,
                      }));
                    }}
                  >
                    <option value="">Unassigned</option>

                    {responders.map((responder) => (
                      <option key={responder.id} value={responder.id}>
                        {responder.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  Instructions
                  <textarea
                    value={
                      assignmentInstructions[event.id] ??
                      event.instructions ??
                      ''
                    }
                    disabled={
                      !(
                        assignmentResponderIds[event.id] ??
                        event.assigned_to_id
                      )
                    }
                    onChange={(changeEvent) => {
                      setAssignmentInstructions((current) => ({
                        ...current,
                        [event.id]: changeEvent.target.value,
                      }));
                    }}
                  />
                </label>

                <button
                  type="button"
                  onClick={() => void handleEventAssignment(event)}
                >
                  {updatingAssignmentEventId === event.id
                    ? 'Saving assignment…'
                    : event.assigned_to_id
                      ? 'Update assignment'
                      : 'Assign responder'}
                </button>
              </fieldset>
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
  );
}
