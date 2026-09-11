import { useState, useEffect, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createDevice } from './device-api';
import { createDeviceGroup, listDeviceGroups, type DeviceGroup } from '../device-groups/device-group-api';

export function RegisterDevicePage() {

  const CREATE_GROUP_VALUE = '__create_group__';

  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [groups, setGroups] = useState<DeviceGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [groupsError, setGroupsError] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [newGroupName, setNewGroupName] = useState('');

  useEffect(() => {
    let active = true;

    listDeviceGroups()
      .then(({ groups }) => {
        if (active) {
          setGroups(groups);
          setGroupsError('');
        }
      })
      .catch(() => {
        if (active) {
          setGroupsError(
            'Unable to load device groups. You can still register an ungrouped device.',
          );
        }
      })
      .finally(() => {
        if (active) {
          setGroupsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) return;

    if (
      selectedGroupId === CREATE_GROUP_VALUE &&
      !newGroupName.trim()
    ) {
      setError('Provide a name for the new device group.');
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccess('');

    let createdGroup: DeviceGroup | null = null;

    try {
      let groupId: string | null = selectedGroupId || null;

      if (selectedGroupId === CREATE_GROUP_VALUE) {
        const result = await createDeviceGroup(newGroupName.trim());
        createdGroup = result.group;
        groupId = createdGroup.id;

        setGroups((currentGroups) =>
          [...currentGroups, createdGroup!].sort((left, right) =>
            left.name.localeCompare(right.name),
          ),
        );

        // If device registration subsequently fails, retry using the
        // group that was successfully created.
        setSelectedGroupId(createdGroup.id);
        setNewGroupName('');
      }

      const { device } = await createDevice(
        name,
        location,
        groupId,
      );

      setSuccess(`Registered ${device.name}.`);
      setName('');
      setLocation('');
      setSelectedGroupId('');
      setNewGroupName('');
    } catch (error: unknown) {
      if (createdGroup) {
        setError(
          `${createdGroup.name} was created, but device registration failed. Retry to use the new group.`,
        );
      } else {
        setError(
          error instanceof Error
            ? error.message
            : 'Unable to register the device.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="form-page">
      <Link className="back-link" to="/devices">← Back to devices</Link>
      <div className="page-heading"><div><p className="eyebrow">DEVICE MANAGEMENT</p><h2>Register device</h2><p>Add a camera endpoint to the monitoring network.</p></div></div>

      <form className="form-panel" onSubmit={handleSubmit}>
        <fieldset disabled={submitting}>
          <legend>Device details</legend>

          <label htmlFor="device-name">Name</label>
          <input
            id="device-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            required
          />

          <label htmlFor="device-location">Location</label>
          <input
            id="device-location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            maxLength={200}
            required
          />

          <label htmlFor="device-group">Device group</label>
          <select
            id="device-group"
            value={selectedGroupId}
            onChange={(event) => setSelectedGroupId(event.target.value)}
            disabled={groupsLoading}
          >
            <option value="">
              {groupsLoading ? 'Loading groups…' : 'No group'}
            </option>

            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}

            <option value={CREATE_GROUP_VALUE}>
              Create new group…
            </option>
          </select>

          {selectedGroupId === CREATE_GROUP_VALUE && (
            <>
              <label htmlFor="new-device-group-name">
                New group name
              </label>

              <input
                id="new-device-group-name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                maxLength={100}
                required
                autoFocus
              />
            </>
          )}

          {groupsError && <p role="alert">{groupsError}</p>}

          <div className="form-actions"><Link className="button-secondary" to="/devices">Cancel</Link><button type="submit">
            {submitting ? 'Registering…' : 'Register device'}
          </button></div>
        </fieldset>

        {error && <p role="alert">{error}</p>}
        {success && <p role="status">{success}</p>}
      </form>
    </section>
  );
}