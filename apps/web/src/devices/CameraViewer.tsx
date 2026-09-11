import { useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';

import { getViewingConnection } from './camera-api';

export function CameraViewer({
  deviceId,
  online,
  streamVersion,
}: {
  deviceId: string;
  online: boolean;
  streamVersion: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [status, setStatus] = useState('Connecting…');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!online || !streamVersion) {
      setStatus('Waiting for camera to come online…');
      setError('');
      return;
    }

    const room = new Room();

    let cancelled = false;
    let attached: RemoteTrack | undefined;

    const detach = () => {
      if (videoRef.current) {
        attached?.detach(videoRef.current);
        videoRef.current.srcObject = null;
      }

      attached = undefined;
    };

    setStatus('Connecting…');
    setError('');

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (
        cancelled ||
        track.kind !== Track.Kind.Video ||
        !videoRef.current
      ) {
        return;
      }

      detach();
      attached = track;
      track.attach(videoRef.current);

      setStatus('Receiving video');
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (cancelled || track !== attached) return;

      detach();
      setStatus('Waiting for camera video…');
    });

    room.on(RoomEvent.Reconnecting, () => {
      if (!cancelled) {
        setStatus('Reconnecting…');
      }
    });

    room.on(RoomEvent.Reconnected, () => {
      if (!cancelled) {
        setStatus(
          attached
            ? 'Receiving video'
            : 'Waiting for camera video…',
        );
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;

      detach();
      setStatus('Disconnected');
      setError(
        'The video connection ended. Retry to reconnect.',
      );
    });

    const connect = async () => {
      try {
        const connection =
          await getViewingConnection(deviceId);

        if (cancelled) return;

        await room.connect(
          connection.serverUrl,
          connection.token,
          {
            autoSubscribe: true,
          },
        );

        if (cancelled) {
          await room.disconnect();
          return;
        }

        if (!attached) {
          setStatus('Waiting for camera video…');
        }
      } catch (caught) {
        if (cancelled) return;

        room.removeAllListeners();
        detach();

        await room.disconnect().catch(() => {});

        if (!cancelled) {
          setStatus('Unable to connect');

          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to load video.',
          );
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;

      room.removeAllListeners();
      detach();

      void room.disconnect().catch(() => {});
    };
  }, [
    deviceId,
    online,
    streamVersion,
    attempt,
  ]);

  return (
    <section
      className={`camera-viewer ${
        online ? 'is-online' : 'is-offline'
      }`}
      aria-label="Camera feed"
    >
      {!online || !streamVersion ? (
        <div className="camera-offline-state">
          <span aria-hidden="true">◉</span>
          <strong>Camera unavailable</strong>
          <small>
            Waiting for this device to start reporting.
          </small>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            controls
            aria-label="Remote camera video"
          />

          <div className="camera-viewer-status">
            <span role="status">{status}</span>

            {error && (
              <span role="alert">{error}</span>
            )}

            <button
              onClick={() =>
                setAttempt((value) => value + 1)
              }
            >
              Reconnect
            </button>
          </div>
        </>
      )}
    </section>
  );
}