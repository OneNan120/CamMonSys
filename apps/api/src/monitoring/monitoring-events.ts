import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

export function notifyDevicesChanged() {
  emitter.emit('devices-changed');
}

export function subscribeToDeviceChanges(
  listener: () => void,
): () => void {
  emitter.on('devices-changed', listener);

  return () => {
    emitter.off('devices-changed', listener);
  };
}