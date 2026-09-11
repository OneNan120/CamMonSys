import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listMyAssignments, type MonitoringEvent, updateEventStatus } from '../devices/event-api';
import { useMonitoringStream } from '../monitoring/MonitoringStreamContext';

export function ResponderAssignmentsPage() {
    const { eventRevision, connectionState } = useMonitoringStream();
    const [assignments, setAssignments] = useState<MonitoringEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [refreshError, setRefreshError] = useState('');
    const [attempt, setAttempt] = useState(0);
    const [completionNotes, setCompletionNotes] = useState<Record<string, string>>({});
    const [updatingEventId, setUpdatingEventId] = useState<string | null>(null);
    const [actionError, setActionError] = useState('');

    useEffect(() => {
        let active = true;
        let refreshing = false;
        let refreshAgain = false;

        if (assignments.length === 0) setLoading(true);
        setLoadError('');
        setRefreshError('');

        async function refreshAssignments(initialLoad = false) {
            if (!active) return;

            if (refreshing) {
                refreshAgain = true;
                return;
            }

            refreshing = true;

            try {
                const result = await listMyAssignments();

                if (active) {
                    setAssignments(result.events);
                    setLoadError('');
                    setRefreshError('');
                }
            } catch (error: unknown) {
                if (active) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'Unable to load your assignments.';

                    if (initialLoad) {
                        setLoadError(message);
                    } else {
                        setRefreshError(
                            'Unable to refresh assignments. Displayed data may be outdated.',
                        );
                    }
                }
            } finally {
                refreshing = false;

                if (active && initialLoad) {
                    setLoading(false);
                }

                if (active && refreshAgain) {
                    refreshAgain = false;
                    void refreshAssignments();
                }
            }
        }

        void refreshAssignments(true);

        return () => { active = false; };
        }, [attempt, eventRevision]);

        async function handleStatusUpdate(
    assignment: MonitoringEvent,
    ) {
    if (updatingEventId) return;

    const nextStatus =
        assignment.status === 'OPEN'
        ? 'ACKNOWLEDGED'
        : 'RESOLVED';

    setUpdatingEventId(assignment.id);
    setActionError('');

    try {
        await updateEventStatus(
        assignment.id,
        nextStatus,
        nextStatus === 'RESOLVED'
            ? completionNotes[assignment.id]
            : undefined,
        );

        const result = await listMyAssignments();
        setAssignments(result.events);
        setRefreshError('');

        setCompletionNotes((current) => {
        const next = { ...current };
        delete next[assignment.id];
        return next;
        });
    } catch (error: unknown) {
        setActionError(
        error instanceof Error
            ? error.message
            : 'Unable to update the assignment.',
        );

        try {
        const result = await listMyAssignments();
        setAssignments(result.events);
        } catch {
        setRefreshError(
            'Unable to refresh assignments. Displayed data may be outdated.',
        );
        }
    } finally {
        setUpdatingEventId(null);
    }
    }

    return (
        <section aria-labelledby="assignments-heading">{connectionState==='reconnecting'&&<p className="stream-warning">Live updates interrupted. Reconnecting…</p>}
            <h1 id="assignments-heading">My assignments</h1>

            {refreshError && <p role="alert">{refreshError}</p>}
            {actionError && <p role="alert">{actionError}</p>}

            {loading ? (
                <p role="status">Loading assignments…</p>
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
            ) : assignments.length === 0 ? (
                <p>You have no active assignments.</p>
            ) : (
                <ul>
                    {assignments.map((assignment) => (
                        <li key={assignment.id}>
                            <h2>{assignment.type.replaceAll('_', ' ')}</h2>

                            <p>Status: {assignment.status}</p>
                            <p>
                                Device:{' '}
                                <Link to={`/devices/${assignment.device_id}`}>
                                    {assignment.device_name}
                                </Link>
                            </p>
                            <p>Location: {assignment.device_location}</p>

                            <p>
                                Created:{' '}
                                {new Date(assignment.created_at).toLocaleString()}
                            </p>

                            <p>
                                Instructions:{' '}
                                {assignment.instructions ?? 'No instructions provided.'}
                            </p>

                            {assignment.assigned_by_name && (
                                <p>Assigned by: {assignment.assigned_by_name}</p>
                            )}

                            {assignment.acknowledged_at && (
                                <p>
                                    Acknowledged:{' '}
                                    {new Date(
                                        assignment.acknowledged_at,
                                    ).toLocaleString()}
                                </p>
                            )}

                            {assignment.status === 'ACKNOWLEDGED' && (
                                <label>
                                    Completion note (optional)
                                    <textarea
                                    value={completionNotes[assignment.id] ?? ''}
                                    maxLength={1000}
                                    disabled={updatingEventId !== null}
                                    onChange={(event) => {
                                        setCompletionNotes((current) => ({
                                        ...current,
                                        [assignment.id]: event.target.value,
                                        }));
                                    }}
                                    />
                                </label>
                                )}

                                <button
                                    type="button"
                                    disabled={updatingEventId !== null}
                                    onClick={() => void handleStatusUpdate(assignment)}
                                >
                                    {updatingEventId === assignment.id
                                        ? 'Updating…'
                                        : assignment.status === 'OPEN'
                                        ? 'Acknowledge assignment'
                                        : 'Resolve assignment'}
                                </button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}