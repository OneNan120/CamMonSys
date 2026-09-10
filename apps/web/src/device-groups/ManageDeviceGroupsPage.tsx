import { useEffect, useState, type FormEvent } from 'react';
import { deleteDeviceGroup, listDeviceGroups, type DeviceGroup, createDeviceGroup } from './device-group-api';

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
            .then(({ groups }) => {
                if (active) {
                    setGroups(groups);
                }
            })
            .catch(() => {
                if (active) {
                    setLoadError('Unable to load device groups.');
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
    }, [attempt]);

    async function handleCreate(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (creating || deletingGroupId) return;

        const normalizedName = newGroupName.trim();

        if (!normalizedName) {
            setActionError('Provide a device-group name.');
            return;
        }

        setCreating(true);
        setActionError('');

        try {
            const { group } = await createDeviceGroup(normalizedName);

            setGroups((currentGroups) =>
            [...currentGroups, group].sort((left, right) =>
                left.name.localeCompare(right.name),
            ),
            );

            setNewGroupName('');
        } catch (error: unknown) {
            setActionError(
            error instanceof Error
                ? error.message
                : 'Unable to create the device group.',
            );
        } finally {
            setCreating(false);
        }
    }

    async function handleDelete(group: DeviceGroup) {
        if (deletingGroupId) return;

        const confirmed = window.confirm(
            `Delete ${group.name}? Devices in this group will become ungrouped.`,
        );

        if (!confirmed) return;

        setDeletingGroupId(group.id);
        setActionError('');

        try {
            await deleteDeviceGroup(group.id);

            setGroups((currentGroups) =>
                currentGroups.filter(
                    (currentGroup) => currentGroup.id !== group.id,
                ),
            );
        } catch (error: unknown) {
            setActionError(
                error instanceof Error
                    ? error.message
                    : 'Unable to delete the device group.',
            );
        } finally {
            setDeletingGroupId(null);
        }
    }

    return (
        <section>
            <h1>Manage device groups</h1>
            <form onSubmit={handleCreate}>
                <fieldset
                    disabled={
                    loading ||
                    Boolean(loadError) ||
                    creating ||
                    deletingGroupId !== null
                    }
                >
                    <legend>Create device group</legend>

                    <label htmlFor="device-group-name">Group name</label>
                    <input
                    id="device-group-name"
                    value={newGroupName}
                    onChange={(event) => setNewGroupName(event.target.value)}
                    maxLength={100}
                    required
                    />

                    <button type="submit">
                    {creating ? 'Creating…' : 'Create group'}
                    </button>
                </fieldset>
                </form>
            {actionError && <p role="alert">{actionError}</p>}

            {loading ? (
                <p role="status">Loading device groups…</p>
            ) : loadError ? (
                <div>
                    <p role="alert">{loadError}</p>
                    <button
                        type="button"
                        onClick={() => setAttempt((value) => value + 1)}
                    >
                        Retry
                    </button>
                </div>
            ) : groups.length === 0 ? (
                <p>No device groups have been created yet.</p>
            ) : (
                <ul>
                    {groups.map((group) => (
                        <li key={group.id}>
                            <span>{group.name}</span>{' '}

                            <button
                                type="button"
                                disabled={creating || deletingGroupId !== null}
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