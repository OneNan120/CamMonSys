import { ApiError } from '../api';
import { sendHeartbeat } from './camera-api';

type HeartbeatOptions = {
  deviceId: string;
  publishingSessionId: string;
  intervalSeconds: number;
  onSuccess: () => void;
  onTemporaryFailure: () => void;
  onSessionEnded: () => void;
};

export function startHeartbeatLoop({
  deviceId,
  publishingSessionId,
  intervalSeconds,
  onSuccess,
  onTemporaryFailure,
  onSessionEnded,
}: HeartbeatOptions) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function run() {
    try {
      await sendHeartbeat(deviceId, publishingSessionId);

      if (!stopped) onSuccess();
    } catch (error: unknown) {
      if (stopped) return;

      if (
        error instanceof ApiError &&
        [401, 403, 404, 409].includes(error.status)
      ) {
        stopped = true;
        onSessionEnded();
        return;
      }

      onTemporaryFailure();
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void run();
        }, intervalSeconds * 1000);
      }
    }
  }

  void run();

  return function stopHeartbeatLoop() {
    stopped = true;

    if (timer) {
      clearTimeout(timer);
    }
  };
}