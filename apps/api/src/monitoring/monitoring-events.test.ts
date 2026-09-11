import { expect, it, vi } from 'vitest';

import {
  closeMonitoringStreams,
  notifyDevicesChanged,
  notifyEventsChanged,
  onMonitoringShutdown,
  subscribeToDeviceChanges,
  subscribeToEventChanges,
} from './monitoring-events.js';

it('delivers device and event invalidations and supports unsubscribe', () => {
  const devices = vi.fn();
  const events = vi.fn();
  const stopDevices = subscribeToDeviceChanges(devices);
  const stopEvents = subscribeToEventChanges(events);

  notifyDevicesChanged();
  notifyEventsChanged();

  expect(devices).toHaveBeenCalledTimes(1);
  expect(events).toHaveBeenCalledTimes(1);

  stopDevices();
  stopEvents();

  notifyDevicesChanged();
  notifyEventsChanged();

  expect(devices).toHaveBeenCalledTimes(1);
  expect(events).toHaveBeenCalledTimes(1);
});

it('closes active monitoring streams during shutdown', () => {
  const first = vi.fn();
  const second = vi.fn();
  const removeFirst = onMonitoringShutdown(first);

  onMonitoringShutdown(second);
  removeFirst();
  closeMonitoringStreams();

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});