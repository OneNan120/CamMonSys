import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { env } from '../config.js';

type CameraAccess = 'publish' | 'view';

const serviceUrl = new URL(env.LIVEKIT_URL);
serviceUrl.protocol = 'https:';

const roomService = new RoomServiceClient(
  serviceUrl.toString(),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

export function cameraRoomName(
  deviceId: string,
  publishingSessionId: string,
) {
  return `device-${deviceId}-session-${publishingSessionId}`;
}

export async function createCameraToken(
  deviceId: string,
  publishingSessionId: string,
  participantIdentity: string,
  access: CameraAccess,
) {
  const room = cameraRoomName(deviceId, publishingSessionId);
  const publishing = access === 'publish';

  const token = new AccessToken(
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
    {
      identity: participantIdentity,
      ttl: '5m',
    },
  );

  token.addGrant({
    roomJoin: true,
    room,
    canPublish: publishing,
    canPublishSources: publishing ? [TrackSource.CAMERA] : [],
    canSubscribe: !publishing,
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });

  return {
    serverUrl: env.LIVEKIT_URL,
    token: await token.toJwt(),
  };
}

export async function closeCameraRoom(
  deviceId: string,
  publishingSessionId: string,
): Promise<void> {
  const room = cameraRoomName(deviceId, publishingSessionId);

  try {
    await roomService.deleteRoom(room);
  } catch (error: unknown) {
    // A room that already disappeared needs no further deletion.
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found'
    ) {
      return;
    }

    throw error;
  }
}

export async function disconnectResponderFromCamera(
  deviceId: string,
  publishingSessionId: string,
  responderId: string,
): Promise<void> {
  const room = cameraRoomName(deviceId, publishingSessionId);
  const identity = `responder-${responderId}`;

  try {
    await roomService.removeParticipant(room, identity);
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'not_found'
    ) {
      return;
    }

    throw error;
  }
}