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
};

export function listEvents(deviceId?: string) {
    const query = deviceId
        ? `?deviceId=${encodeURIComponent(deviceId)}`
        : '';

    return apiRequest<{ events: MonitoringEvent[] }>(
        `/api/events${query}`,
    );
}