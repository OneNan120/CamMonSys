import { env } from '../config.js';
import { processRoomCleanup } from './room-cleanup.service.js';
import { expirePublishingSessions } from '../devices/publishing.service.js';

export function startRoomCleanupWorker() {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  async function run() {
    try {
        await expirePublishingSessions();
        await processRoomCleanup();
    } catch {
      // Handles failures such as being unable to fetch pending records.
      console.error('Unable to run camera room cleanup.');
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          running = run();
        }, env.CAMERA_CLEANUP_INTERVAL_SECONDS * 1000);

        timer.unref();
      }
    }
  }

  running = run();

  return async function stopRoomCleanupWorker() {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
    }

    await running;
  };
}