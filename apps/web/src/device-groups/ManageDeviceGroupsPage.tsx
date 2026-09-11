import { useEffect, useState, type FormEvent } from 'react';

import {
  createDeviceGroup,
  deleteDeviceGroup,
  listDeviceGroups,
  type DeviceGroup,
} from './device-group-api';

export function ManageDeviceGroupsPage() {
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [newGroupName, setNewGroupName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setLoadError('');

    listDeviceGroups()
      .then(({ groups }) => active && setGroups(groups))
      .catch(
        () =>
          active &&
          setLoadError('Unable to load device groups.'),
      )
      .finally(() => active && setLoading(false));

    return () => {
      active = false;
    };
  }, [attempt]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();

    if (creating || deletingGroupId) return;

    const name = newGroupName.trim();

    if (!name) {
      setActionError('Provide a device-group name.');
      return;
    }

    setCreating(true);
    setActionError('');

    try {
      const { group } = await createDeviceGroup(name);

      setGroups((current) =>
        [...current, group].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      );

      setNewGroupName('');
    } catch (e) {
      setActionError(
        e instanceof Error
          ? e.message
          : 'Unable to create the device group.',
      );
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (group: DeviceGroup) => {
    if (
      deletingGroupId ||
      !window.confirm(
        `Delete ${group.name}? Devices in this group will become ungrouped.`,
      )
    ) {
      return;
    }

    setDeletingGroupId(group.id);
    setActionError('');

    try {
      await deleteDeviceGroup(group.id);

      setGroups((current) =>
        current.filter((item) => item.id !== group.id),
      );
    } catch (e) {
      setActionError(
        e instanceof Error
          ? e.message
          : 'Unable to delete the device group.',
      );
    } finally {
      setDeletingGroupId(null);
    }
  };

  return (
    <section className="groups-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">DEVICE ORGANIZATION</p>
          <h2>Device groups</h2>
          <p>Organize cameras for filtering.</p>
        </div>
      </div>

      <form
        className="group-create-bar"
        onSubmit={handleCreate}
      >
        <label
          className="sr-only"
          htmlFor="device-group-name"
        >
          New group name
        </label>

        <input
          id="device-group-name"
          value={newGroupName}
          onChange={(event) =>
            setNewGroupName(event.target.value)
          }
          maxLength={100}
          required
          placeholder="New group name"
          disabled={
            loading ||
            Boolean(loadError) ||
            creating ||
            deletingGroupId !== null
          }
        />

        <button
          disabled={
            loading ||
            Boolean(loadError) ||
            creating ||
            deletingGroupId !== null
          }
        >
          {creating ? 'Creating…' : 'Create group'}
        </button>
      </form>

      {actionError && (
        <p role="alert">{actionError}</p>
      )}

      {loading ? (
        <p role="status">Loading device groups…</p>
      ) : loadError ? (
        <div className="empty-state">
          <p role="alert">{loadError}</p>

          <button
            onClick={() => setAttempt((v) => v + 1)}
          >
            Retry
          </button>
        </div>
      ) : groups.length === 0 ? (
        <p className="empty-panel">
          No device groups have been created.
        </p>
      ) : (
        <ul className="group-list">
          {groups.map((group) => (
            <li key={group.id}>
              <div>
                <strong>{group.name}</strong>
                <small>Device group</small>
              </div>

              <button
                className="button-quiet"
                disabled={
                  creating || deletingGroupId !== null
                }
                onClick={() => void handleDelete(group)}
              >
                {deletingGroupId === group.id
                  ? 'Deleting…'
                  : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}