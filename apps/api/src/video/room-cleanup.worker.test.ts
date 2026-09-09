import { afterEach, beforeEach, describe, expect, it, vi, } from 'vitest';

const { cleanupMock } = vi.hoisted(() => ({
  cleanupMock: vi.fn<() => Promise<void>>(),
}));

vi.mock('../config.js', () => ({
  env: {
    CAMERA_CLEANUP_INTERVAL_SECONDS: 10,
  },
}));

vi.mock('./room-cleanup.service.js', () => ({
  processRoomCleanup: cleanupMock,
}));

vi.mock('../devices/publishing.service.js', () => ({
  expirePublishingSessions: vi.fn(async () => 0),
}));

import { startRoomCleanupWorker } from './room-cleanup.worker.js';

beforeEach(() => {
  vi.useFakeTimers();
  cleanupMock.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('room cleanup worker', () => {
  it('waits for cleanup to finish before scheduling another run', async () => {
    let finishFirstRun!: () => void;

    cleanupMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirstRun = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const stop = startRoomCleanupWorker();
    await vi.advanceTimersByTimeAsync(0);

    expect(cleanupMock).toHaveBeenCalledTimes(1);

    // Even after a minute, the unfinished run must not overlap.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    finishFirstRun();
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(9_999);
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(cleanupMock).toHaveBeenCalledTimes(2);

    await stop();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(cleanupMock).toHaveBeenCalledTimes(2);
  });

  it('waits for an active run when stopping', async () => {
    let finishRun!: () => void;

    cleanupMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRun = resolve;
        }),
    );

    const stop = startRoomCleanupWorker();
    await vi.advanceTimersByTimeAsync(0);

    let stopped = false;
    const stopping = stop().then(() => {
      stopped = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finishRun();
    await stopping;

    expect(stopped).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});