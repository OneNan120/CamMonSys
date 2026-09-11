import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
const shutdownListeners = new Set<() => void>();

export function onMonitoringShutdown(listener: () => void) {
  shutdownListeners.add(listener);
  return () => { shutdownListeners.delete(listener); };
}

export function closeMonitoringStreams() {
  for (const listener of [...shutdownListeners]) listener();
}

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

export function notifyEventsChanged() {
  emitter.emit('events-changed');
}

export function subscribeToEventChanges(
  listener: () => void,
): () => void {
  emitter.on('events-changed', listener);

  return () => {
    emitter.off('events-changed', listener);
  };
}
