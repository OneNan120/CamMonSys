import { apiRequest } from '../api';

export type MonitoringEvent = {
    id: string;
    device_id: string;
    device_name: string;
    device_location: string;
    type: 'TEST_ALERT' | 'MOTION' | 'BED_EXIT';
    status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
    created_at: string;
    acknowledged_at: string | null;
    acknowledged_by_name: string | null;
    resolved_at: string | null;
    resolved_by_name: string | null;
    assigned_to_id: string | null;
    assigned_to_name: string | null;
    assigned_by_name: string | null;
    instructions: string | null;
    completion_note: string | null;
    snapshot_available: boolean;
    snapshot_captured_at: string | null;
};

export function listEvents(deviceId?: string) {
    const query = deviceId
        ? `?deviceId=${encodeURIComponent(deviceId)}`
        : '';

    return apiRequest<{ events: MonitoringEvent[] }>(
        `/api/events${query}`,
    );
}

export async function updateEventStatus(
  eventId: string,
  status: 'ACKNOWLEDGED' | 'RESOLVED',
  completionNote?: string,
): Promise<void> {
  const trimmedNote = completionNote?.trim();

  await apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(status === 'RESOLVED' && trimmedNote
          ? { completionNote: trimmedNote }
          : {}),
      }),
    },
  );
}

export type EventAssignmentRequest =
  | {
      responderId: string;
      instructions: string;
    }
  | {
      responderId: null;
      instructions?: null;
    };

export async function updateEventAssignment(
  eventId: string,
  assignment: EventAssignmentRequest,
): Promise<void> {
  await apiRequest(
    `/api/events/${encodeURIComponent(eventId)}/assignment`,
    {
      method: 'PATCH',
      body: JSON.stringify(assignment),
    },
  );
}

export function listMyAssignments() {
  return apiRequest<{ events: MonitoringEvent[] }>(
    '/api/events?assignedTo=me',
  );
}
export function getEvent(eventId: string) {
  return apiRequest<{ event: MonitoringEvent }>(`/api/events/${encodeURIComponent(eventId)}`);
}

export function eventSnapshotUrl(eventId: string) {
  return `/api/events/${encodeURIComponent(eventId)}/snapshot`;
}
