import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  listDevices,
  type DeviceSummary,
} from './device-api';
import {
  listEvents,
  type MonitoringEvent,
} from './event-api';
import {
  listDeviceGroups,
  type DeviceGroup,
} from '../device-groups/device-group-api';
import { EventCard } from '../events/EventCard';
import { DashboardCameraPreview } from './DashboardCameraPreview';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';
import {
  listResponders,
  type ResponderSummary,
} from '../responders/responder-api';

type DashboardFilter =
  | 'all'
  | 'online'
  | 'offline'
  | 'open';

export function DeviceListPage({
  canRegister = false,
}: {
  canRegister?: boolean;
}) {
  const {
    deviceRevision,
    eventRevision,
    connectionState,
  } = useMonitoringStream();

  const requestId = useRef(0);

  const [responders, setResponders] = useState<
    ResponderSummary[]
  >([]);

  const [devices, setDevices] = useState<
    DeviceSummary[]
  >([]);

  const [events, setEvents] = useState<
    MonitoringEvent[]
  >([]);

  const [groups, setGroups] = useState<
    DeviceGroup[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filter, setFilter] =
    useState<DashboardFilter>('all');

  const [groupFilter, setGroupFilter] =
    useState('all');

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    const id = ++requestId.current;

    if (
      devices.length === 0 &&
      events.length === 0
    ) {
      setLoading(true);
    }

    setError('');

    Promise.all([
      listDevices(),
      listEvents(),
      listDeviceGroups(),
      listResponders().catch(() => ({
        responders: [],
      })),
    ])
      .then(([d, e, g, r]) => {
        if (
          active &&
          id === requestId.current
        ) {
          setDevices(d.devices);
          setEvents(e.events);
          setGroups(g.groups);
          setResponders(r.responders);
        }
      })
      .catch((e: unknown) => {
        if (
          active &&
          id === requestId.current
        ) {
          setError(
            e instanceof Error
              ? e.message
              : 'Unable to refresh dashboard data.',
          );
        }
      })
      .finally(() => {
        if (
          active &&
          id === requestId.current
        ) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    attempt,
    deviceRevision,
    eventRevision,
  ]);

  useEffect(() => {
    if (
      groupFilter !== 'all' &&
      groupFilter !== 'ungrouped' &&
      !groups.some(
        (group) => group.id === groupFilter,
      )
    ) {
      setGroupFilter('all');
    }
  }, [groupFilter, groups]);

  const devicesInGroup = useMemo(
    () =>
      devices.filter((device) =>
        groupFilter === 'all'
          ? true
          : groupFilter === 'ungrouped'
            ? !device.group_id
            : device.group_id === groupFilter,
      ),
    [devices, groupFilter],
  );

  const groupDeviceIds = useMemo(
    () =>
      new Set(
        devicesInGroup.map(
          (device) => device.id,
        ),
      ),
    [devicesInGroup],
  );

  const eventsInGroup = useMemo(
    () =>
      events.filter((event) =>
        groupDeviceIds.has(event.device_id),
      ),
    [events, groupDeviceIds],
  );

  const onlineIds = useMemo(
    () =>
      new Set(
        devicesInGroup
          .filter(
            (d) => d.status === 'ONLINE',
          )
          .map((d) => d.id),
      ),
    [devicesInGroup],
  );

  const offlineIds = useMemo(
    () =>
      new Set(
        devicesInGroup
          .filter(
            (d) => d.status === 'OFFLINE',
          )
          .map((d) => d.id),
      ),
    [devicesInGroup],
  );

  const openIds = useMemo(
    () =>
      new Set(
        eventsInGroup
          .filter(
            (e) => e.status === 'OPEN',
          )
          .map((e) => e.device_id),
      ),
    [eventsInGroup],
  );

  const shownDevices = devicesInGroup.filter(
    (d) =>
      filter === 'all' ||
      (filter === 'online' &&
        onlineIds.has(d.id)) ||
      (filter === 'offline' &&
        offlineIds.has(d.id)) ||
      (filter === 'open' &&
        openIds.has(d.id)),
  );

  const shownEvents = eventsInGroup.filter(
    (e) =>
      filter === 'all' ||
      (filter === 'online' &&
        onlineIds.has(e.device_id)) ||
      (filter === 'offline' &&
        offlineIds.has(e.device_id)) ||
      (filter === 'open' &&
        e.status === 'OPEN'),
  );

  const groupNames = new Map(
    groups.map((g) => [
      g.id,
      g.name,
    ]),
  );

  const select = (
    next: DashboardFilter,
  ) =>
    setFilter((current) =>
      current === next && next !== 'all'
        ? 'all'
        : next,
    );

  if (loading) {
    return (
      <section
        className="skeleton-grid"
        aria-label="Loading dashboard"
      >
        <div />
        <div />
        <div />
        <div />
      </section>
    );
  }

  if (
    error &&
    devices.length === 0 &&
    events.length === 0
  ) {
    return (
      <section className="empty-state">
        <p role="alert">
          {error}
        </p>

        <button
          onClick={() =>
            setAttempt((v) => v + 1)
          }
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      {error && (
        <p
          className="stream-warning"
          role="status"
        >
          {error}
        </p>
      )}

      {connectionState ===
        'reconnecting' && (
        <p
          className="stream-warning"
          role="status"
        >
          Live updates interrupted.
          Reconnecting…
        </p>
      )}

      <div className="page-heading">
        <div>
          <p className="eyebrow">
            LIVE OPERATIONS
          </p>

          <h2>
            Active Camera Network
          </h2>
        </div>

        <Link
          className="text-link"
          to="/devices"
        >
          View all devices →
        </Link>
      </div>

      <div
        className="kpi-grid"
        aria-label="Dashboard filters"
      >
        {(
          [
            [
              'all',
              'Total Devices',
              devicesInGroup.length,
            ],
            [
              'online',
              'Online Cameras',
              onlineIds.size,
            ],
            [
              'offline',
              'Offline Cameras',
              offlineIds.size,
            ],
            [
              'open',
              'Open Events',
              eventsInGroup.filter(
                (e) =>
                  e.status === 'OPEN',
              ).length,
            ],
          ] as const
        ).map(
          ([id, label, value]) => (
            <button
              key={id}
              className={
                filter === id
                  ? 'active'
                  : ''
              }
              aria-pressed={
                filter === id
              }
              onClick={() =>
                select(id)
              }
            >
              <span className="kpi-icon">
                {id === 'online'
                  ? '✓'
                  : id === 'offline'
                    ? '!'
                    : id === 'open'
                      ? '⌁'
                      : '▣'}
              </span>

              <span>
                <small>
                  {label}
                </small>

                <strong>
                  {value}
                </strong>
              </span>
            </button>
          ),
        )}

        <div
          className={`kpi-group-filter${
            groupFilter !== 'all'
              ? ' active'
              : ''
          }`}
        >
          <span
            className="kpi-icon"
            aria-hidden="true"
          >
            ◫
          </span>

          <div>
            <label htmlFor="dashboard-group-filter">
              Device group
            </label>

            <select
              id="dashboard-group-filter"
              value={groupFilter}
              onChange={(event) =>
                setGroupFilter(
                  event.target.value,
                )
              }
            >
              <option value="all">
                All groups
              </option>

              <option value="ungrouped">
                Ungrouped
              </option>

              {groups.map((group) => (
                <option
                  key={group.id}
                  value={group.id}
                >
                  {group.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="dashboard-columns">
        <section>
          <div className="section-heading">
            <h2>
              {filter === 'all'
                ? 'Devices'
                : `${filter
                    .charAt(0)
                    .toUpperCase()}${filter.slice(
                    1,
                  )} devices`}
            </h2>

            <span>
              {shownDevices.length}
            </span>
          </div>

          {shownDevices.length === 0 ? (
            <p className="empty-panel">
              No devices match this view.
            </p>
          ) : (
            <div className="device-card-grid">
              {shownDevices.map(
                (device) => (
                  <Link
                    className="device-card interactive-card"
                    to={`/devices/${device.id}`}
                    key={device.id}
                  >
                    <DashboardCameraPreview
                      deviceId={device.id}
                      online={device.status === 'ONLINE'}
                      streamVersion={device.stream_version}
                    />

                    <div className="device-card-body">
                      <div>
                        <h3>
                          {device.name}
                        </h3>

                        <span
                          className={`device-state ${device.status.toLowerCase()}`}
                        >
                          <i />
                          {device.status}
                        </span>
                      </div>

                      <p>
                        ⌖{' '}
                        {device.location}
                      </p>

                      <p>
                        Group:{' '}
                        {device.group_id
                          ? groupNames.get(
                              device.group_id,
                            ) ??
                            'Unknown'
                          : 'Ungrouped'}
                      </p>

                      <small>
                        Last seen{' '}
                        {device.last_seen_at
                          ? new Date(
                              device.last_seen_at,
                            ).toLocaleString()
                          : 'Never'}
                      </small>
                    </div>
                  </Link>
                ),
              )}
            </div>
          )}
        </section>

        <section>
          <div className="section-heading">
            <h2>
              Recent events
            </h2>

            <Link to="/events">
              View all
            </Link>
          </div>

          <div className="event-stack">
            {shownEvents
              .slice(0, 8)
              .map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  canAssign
                  responders={
                    responders
                  }
                />
              ))}

            {shownEvents.length ===
              0 && (
              <p className="empty-panel">
                No events match this view.
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}