import { Room, Track } from 'livekit-client';
import type { CameraConnection } from './camera-api';

export function createPublisherRoom() {
  return new Room();
}

export async function publishCameraStream(
  room: Room,
  connection: CameraConnection,
  stream: MediaStream,
  isCancelled: () => boolean,
): Promise<boolean> {
  const track = stream.getVideoTracks()[0];

  if (!track || track.readyState !== 'live') {
    throw new Error('No active camera track is available.');
  }

  if (isCancelled()) return false;

  await room.connect(
    connection.serverUrl,
    connection.token,
    { autoSubscribe: false },
  );

  if (isCancelled()) {
    await room.disconnect();
    return false;
  }

  await room.localParticipant.publishTrack(track, {
    source: Track.Source.Camera,
    name: 'camera',
  });

  if (isCancelled()) {
    await room.disconnect();
    return false;
  }

  return true;
}
