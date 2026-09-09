import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryResult } from 'pg';

const { queryMock, closeRoomMock } = vi.hoisted(() => ({
  queryMock: vi.fn<
    (sql: string, values?: unknown[]) => Promise<QueryResult>
  >(),
  closeRoomMock: vi.fn<
    (deviceId: string, sessionId: string) => Promise<void>
  >(),
}));

vi.mock('../db.js', () => ({
  pool: {
    query: queryMock,
  },
}));

vi.mock('./livekit.service.js', () => ({
  closeCameraRoom: closeRoomMock,
}));

import { processRoomCleanup } from './room-cleanup.service.js';

const record = {
  id: 'cleanup-1',
  device_id: 'device-1',
  publishing_session_id: 'session-1',
};

function queryResult(rows: object[]) {
  return {
    rows,
    rowCount: rows.length,
    command: 'SELECT',
    oid: 0,
    fields: [],
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('room cleanup', () => {
  it('deletes the cleanup record after closing the room', async () => {
    queryMock
      .mockResolvedValueOnce(queryResult([record]))
      .mockResolvedValueOnce(queryResult([]));

    closeRoomMock.mockResolvedValueOnce(undefined);

    await processRoomCleanup();

    expect(closeRoomMock).toHaveBeenCalledWith(
      record.device_id,
      record.publishing_session_id,
    );

    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM camera_room_cleanup WHERE id = $1',
      [record.id],
    );

    const closeOrder = closeRoomMock.mock.invocationCallOrder[0]!;
    const deleteOrder = queryMock.mock.invocationCallOrder[1]!;

    expect(closeOrder).toBeLessThan(deleteOrder);
  });

  it('keeps the cleanup record when closing the room fails', async () => {
    queryMock.mockResolvedValueOnce(queryResult([record]));
    closeRoomMock.mockRejectedValueOnce(new Error('Service unavailable'));

    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await processRoomCleanup();

      // Only the SELECT ran; no DELETE was attempted.
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        'Camera room cleanup failed.',
        { cleanupId: record.id },
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does nothing when no cleanup is pending', async () => {
    queryMock.mockResolvedValueOnce(queryResult([]));

    await processRoomCleanup();

    expect(closeRoomMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});