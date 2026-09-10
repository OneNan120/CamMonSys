import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack, } from 'livekit-client';
import { getViewingConnection } from './camera-api';

export function CameraViewer({ deviceId, online, streamVersion }: { deviceId: string; online: boolean; streamVersion: string | null; }) {
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
    let attachedTrack: RemoteTrack | undefined;

    setStatus('Connecting…');
    setError('');

    function detachVideo() {
      const video = videoRef.current;

      if (video) {
        attachedTrack?.detach(video);
        video.srcObject = null;
      }

      attachedTrack = undefined;
    }

    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (cancelled || track.kind !== Track.Kind.Video) return;

      const video = videoRef.current;
      if (!video) return;

      detachVideo();
      attachedTrack = track;
      track.attach(video);
      setStatus('Receiving video');
    });

    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (cancelled || track !== attachedTrack) return;

      detachVideo();
      setStatus('Waiting for camera video…');
    });

    room.on(RoomEvent.Reconnecting, () => {
      if (!cancelled) setStatus('Reconnecting…');
    });

    room.on(RoomEvent.Reconnected, () => {
      if (!cancelled) {
        setStatus(
          attachedTrack ? 'Receiving video' : 'Waiting for camera video…',
        );
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      if (cancelled) return;

      detachVideo();
      setStatus('Disconnected');
      setError('The video connection ended. Retry to reconnect.');
    });

    async function connect() {
      try {
        const connection = await getViewingConnection(deviceId);

        if (cancelled) return;

        await room.connect(connection.serverUrl, connection.token, {
          autoSubscribe: true,
        });

        if (cancelled) {
          await room.disconnect();
          return;
        }

        if (!attachedTrack) {
          setStatus('Waiting for camera video…');
        }
      } catch (error: unknown) {
        if (cancelled) return;

        // Prevent cleanup from replacing the original error message.
        room.removeAllListeners();
        detachVideo();
        await room.disconnect().catch(() => {});

        if (cancelled) return;

        setStatus('Unable to connect');
        setError(
          error instanceof Error ? error.message : 'Unable to load video.',
        );
      }
    }

    void connect();

    return () => {
      cancelled = true;
      room.removeAllListeners();
      detachVideo();
      void room.disconnect().catch(() => {});
    };
  }, [deviceId, online, streamVersion, attempt]);

  return (
    <section aria-label="Camera feed">
      <h2>Live camera</h2>
      <p role="status">{status}</p>

      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        aria-label="Remote camera video"
        style={{ width: '100%', maxWidth: 720, background: '#111' }}
      />

      {error && <p role="alert">{error}</p>}

      <button onClick={() => setAttempt((value) => value + 1)} disabled={!online}>
        Reconnect
      </button>
    </section>
  );
}