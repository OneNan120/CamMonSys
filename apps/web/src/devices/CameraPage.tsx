import { useEffect, useRef, useState } from 'react';
import { RoomEvent, type Room } from 'livekit-client';
import { ApiError } from '../api';
import { createTestAlert, startCamera as reserveCamera, stopCamera as releaseCamera, } from './camera-api';
import { createPublisherRoom, publishCameraStream, } from './camera-publisher';
import { startHeartbeatLoop } from './camera-heartbeat';

type CameraRun = {
  cancelled: boolean;
  stream?: MediaStream;
  room?: Room;
  publishingSessionId?: string;
  stopHeartbeat?: () => void;
};

export function CameraPage({ deviceId }: { deviceId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const runRef = useRef<CameraRun | null>(null);

  const [status, setStatus] = useState('Stopped');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sendingEvent, setSendingEvent] = useState(false);
  const [eventMessage, setEventMessage] = useState('');

  async function releaseReservation(run: CameraRun) {
    if (!run.publishingSessionId) return;

    const sessionId = run.publishingSessionId;

    try {
      await releaseCamera(deviceId, sessionId);
      run.publishingSessionId = undefined;
    } catch (error) {
      if (
        error instanceof ApiError &&
        [401, 403, 404, 409].includes(error.status)
      ) {
        run.publishingSessionId = undefined;
        return;
      }

      throw error;
    }
  }

  async function dispose(run: CameraRun) {
    run.cancelled = true;
    run.stopHeartbeat?.();
    run.room?.removeAllListeners();
    run.stream?.getTracks().forEach((track) => track.stop());

    const results = await Promise.allSettled([
      run.room?.disconnect(),
      releaseReservation(run),
    ]);

    return results.some((result) => result.status === 'rejected');
  }

  async function stop(run: CameraRun, message = '') {
    if (runRef.current !== run || run.cancelled) return;

    setBusy(true);
    setStatus('Stopping…');

    const cleanupFailed = await dispose(run);

    if (runRef.current !== run) return;

    runRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    setStatus('Stopped');
    setBusy(false);
    setError(
      cleanupFailed
        ? 'Local camera stopped, but remote cleanup could not be confirmed. The lease will expire.'
        : message,
    );
  }

  async function start() {
    if (runRef.current) return;

    const run: CameraRun = { cancelled: false };
    runRef.current = run;

    setBusy(true);
    setError('');
    setStatus('Requesting camera permission…');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires localhost or HTTPS.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });

      if (run.cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      run.stream = stream;

      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          void stop(run, 'Camera capture ended. Start again to retry.');
        });
      }

      const video = videoRef.current;
      if (!video) throw new Error('Camera preview is unavailable.');

      video.srcObject = stream;
      await video.play();

      if (run.cancelled) return;

      setStatus('Reserving device…');

      const connection = await reserveCamera(deviceId);
      run.publishingSessionId = connection.publishingSessionId;

      // Stop may have happened while the request was pending.
      if (run.cancelled) {
        await releaseReservation(run);
        return;
      }

      const room = createPublisherRoom();
      run.room = room;

      room.on(RoomEvent.Disconnected, (reason) => {
        console.error('LiveKit disconnected. Reason:', reason);
        void stop(run, 'Video connection ended. Start again to retry.');
      });

      // End this run instead of reporting heartbeats during reconnection.
      room.on(RoomEvent.Reconnecting, () => {
        void stop(run, 'Video connection interrupted. Start again to retry.');
      });

      setStatus('Connecting video…');

      const published = await publishCameraStream(
        room,
        connection,
        stream,
        () => run.cancelled,
      );

      if (!published || run.cancelled) return;

      setStatus('Video published; confirming device status…');

      run.stopHeartbeat = startHeartbeatLoop({
        deviceId,
        publishingSessionId: connection.publishingSessionId,
        intervalSeconds: connection.heartbeatIntervalSeconds,

        onSuccess: () => {
          if (run.cancelled) return;
          setStatus('Publishing');
          setError('');
        },

        onTemporaryFailure: () => {
          if (run.cancelled) return;
          setStatus('Video published; reporting interrupted');
          setError('Cannot report camera status. Retrying…');
        },

        onSessionEnded: () => {
          void stop(run, 'Camera session expired. Start again.');
        },
      });

      setBusy(false);
    } catch (error: unknown) {
      console.error('Camera startup failed:', error);
      if (run.cancelled) return;

      const message =
        error instanceof DOMException &&
        error.name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow access and retry.'
          : error instanceof Error
            ? error.message
            : 'Unable to start the camera.';

      await stop(run, message);
    }
  }

  async function captureSnapshot(): Promise<Blob> {
    const video = videoRef.current;

    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      throw new Error('Camera preview is not ready.');
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    if (!sourceWidth || !sourceHeight) {
      throw new Error('Camera frame dimensions are unavailable.');
    }

    const scale = Math.min(1, 1280 / sourceWidth, 720 / sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Snapshot capture is unavailable.');

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const snapshot = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });

    if (!snapshot || snapshot.size === 0) {
      throw new Error('Camera returned an empty snapshot.');
    }

    if (snapshot.size > 2 * 1024 * 1024) {
      throw new Error('Captured snapshot is too large.');
    }

    return snapshot;
  }

  async function captureSnapshotWithRetry(): Promise<Blob | undefined> {
    try {
      return await captureSnapshot();
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      try {
        return await captureSnapshot();
      } catch {
        return undefined;
      }
    }
  }

  async function handleTestAlert() {
    const run = runRef.current;

    if (!run?.publishingSessionId || run.cancelled) return;

    setSendingEvent(true);
    setEventMessage('');

    try {
      const snapshot = await captureSnapshotWithRetry();

      await createTestAlert(
        deviceId,
        run.publishingSessionId,
        snapshot,
      );

      setEventMessage(
        snapshot
          ? 'Test Alert and snapshot created.'
          : 'Test Alert created, but the snapshot was unavailable.',
      );
    } catch (error: unknown) {
      setEventMessage(
        error instanceof Error
          ? error.message
          : 'Unable to create Test Alert.',
      );
    } finally {
      setSendingEvent(false);
    }
  }

  useEffect(() => {
    if (status !== 'Publishing') return;
    const message = 'Leaving this page will stop the camera publication.';
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const interceptLink = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!target || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!window.confirm(message)) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', interceptLink, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', interceptLink, true); };
  }, [status]);

  useEffect(() => {
    // Defer one task so StrictMode's setup/cleanup probe cannot start
    // a second permission request. Manual Stop does not restart this effect.
    const startup = window.setTimeout(() => void start(), 0);
    return () => {
      window.clearTimeout(startup);
      const run = runRef.current;
      runRef.current = null;

      if (run) {
        void dispose(run);
      }
    };
    // CameraDevicePage keys this component by deviceId.
  }, [deviceId]);

  return (
    <section className="camera-control-page">
      <div className="page-heading"><div><p className="eyebrow">CAMERA PUBLISHER</p><h2>Camera controls</h2></div></div>
      <p className="camera-lifecycle-note">This camera publishes only while this page remains open. Leaving or pressing Stop ends the session.</p>
      <p role="status">{status}</p>

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        aria-label="Local camera preview"
        className="camera-preview"
      />

      <div className="camera-actions">
        <button
          onClick={() => void start()}
          disabled={busy || status !== 'Stopped'}
        >
          Start camera
        </button>

        <button
          onClick={() => {
            const run = runRef.current;
            if (run) void stop(run);
          }}
          disabled={status === 'Stopped' || status === 'Stopping…'}
        >
          Stop
        </button>
        <button
          onClick={() => void handleTestAlert()}
          disabled={status !== 'Publishing' || sendingEvent}
        >
          {sendingEvent ? 'Sending alert…' : 'Test Alert'}
        </button>
      </div>
      
      {eventMessage && <p role="status">{eventMessage}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
