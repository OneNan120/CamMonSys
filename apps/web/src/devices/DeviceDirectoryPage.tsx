import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  listDevices,
  type DeviceSummary,
} from './device-api';
import {
  listDeviceGroups,
  type DeviceGroup,
} from '../device-groups/device-group-api';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';

export function DeviceDirectoryPage({
  canRegister,
}: {
  canRegister: boolean;
}) {
  const {
    deviceRevision,
    connectionState,
  } = useMonitoringStream();

  const [params, setParams] = useSearchParams();

  const [devices, setDevices] = useState<
    DeviceSummary[]
  >([]);

  const [groups, setGroups] = useState<
    DeviceGroup[]
  >([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    Promise.all([
      listDevices(),
      listDeviceGroups(),
    ])
      .then(([d, g]) => {
        if (active) {
          setDevices(d.devices);
          setGroups(g.groups);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(
            e instanceof Error
              ? e.message
              : 'Unable to load devices.',
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
  }, [deviceRevision]);

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const group = params.get('group') ?? '';

  const update = (
    key: string,
    value: string,
  ) => {
    const next = new URLSearchParams(params);

    value
      ? next.set(key, value)
      : next.delete(key);

    setParams(next, {
      replace: true,
    });
  };

  const shown = useMemo(
    () =>
      devices.filter(
        (d) =>
          (!search ||
            `${d.name} ${d.location}`
              .toLowerCase()
              .includes(search.toLowerCase())) &&
          (!status || d.status === status) &&
          (!group ||
            (group === 'ungrouped'
              ? d.group_id === null
              : d.group_id === group)),
      ),
    [
      devices,
      search,
      status,
      group,
    ],
  );

  const names = new Map(
    groups.map((g) => [
      g.id,
      g.name,
    ]),
  );

  return (
    <section>
      {connectionState === 'reconnecting' && (
        <p
          className="stream-warning"
          role="status"
        >
          Live updates interrupted. Reconnecting…
        </p>
      )}

      <div className="page-heading">
        <div>
          <p className="eyebrow">
            CAMERA NETWORK
          </p>

          <h2>Devices</h2>

          <p>
            Search, filter, and open a camera
            control room.
          </p>
        </div>

        {canRegister && (
          <div className="heading-actions">
            <Link
              className="button-secondary"
              to="/device-groups"
            >
              Device Groups
            </Link>

            <Link
              className="link-button"
              to="/devices/new"
            >
              ＋ Register Device
            </Link>
          </div>
        )}
      </div>

      <div className="device-filter-bar">
        <label className="device-search">
          <span aria-hidden="true">⌕</span>

          <span className="sr-only">
            Search devices
          </span>

          <input
            type="search"
            value={search}
            onChange={(e) =>
              update('search', e.target.value)
            }
            placeholder="Search by device name or location"
          />

          {search && (
            <button
              type="button"
              aria-label="Clear device search"
              onClick={() =>
                update('search', '')
              }
            >
              ×
            </button>
          )}
        </label>

        <label>
          <span>Status</span>

          <select
            value={status}
            onChange={(e) =>
              update('status', e.target.value)
            }
          >
            <option value="">
              All statuses
            </option>

            <option value="ONLINE">
              Online
            </option>

            <option value="OFFLINE">
              Offline
            </option>
          </select>
        </label>

        <label>
          <span>Group</span>

          <select
            value={group}
            onChange={(e) =>
              update('group', e.target.value)
            }
          >
            <option value="">
              All groups
            </option>

            <option value="ungrouped">
              Ungrouped
            </option>

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

        <button
          type="button"
          className="button-quiet"
          onClick={() =>
            setParams(
              new URLSearchParams(),
              {
                replace: true,
              },
            )
          }
        >
          Clear all filters
        </button>
      </div>

      {loading ? (
        <p role="status">
          Loading devices…
        </p>
      ) : error ? (
        <p role="alert">
          {error}
        </p>
      ) : shown.length === 0 ? (
        <p className="empty-panel">
          No devices match the selected filters.
        </p>
      ) : (
        <div className="directory-list">
          {shown.map((d) => (
            <Link
              key={d.id}
              to={`/devices/${d.id}?from=${encodeURIComponent(
                `/devices?${params}`,
              )}`}
              className="directory-row interactive-card"
            >
              <span className="camera-mini">
                ◉
              </span>

              <span>
                <strong>
                  {d.name}
                </strong>

                <small>
                  {d.location}
                </small>
              </span>

              <span>
                {d.group_id
                  ? names.get(d.group_id) ??
                    'Unknown'
                  : 'Ungrouped'}
              </span>

              <span
                className={`device-state ${d.status.toLowerCase()}`}
              >
                <i />
                {d.status}
              </span>

              <span>→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}