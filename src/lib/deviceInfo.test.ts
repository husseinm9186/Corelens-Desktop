import { describe, expect, it } from 'vitest';
import { deviceInfoPatch } from './deviceInfo';
import type { DeviceInfo } from './ipc';
import type { DeviceNodeData } from '../types/domain';

const info = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  hostname: 'EXAMPLE-SW',
  family: 'Cisco IOS',
  model: 'C9300-48P',
  serials: ['FOC0000TEST', 'FOC0001TEST'],
  software: 'Cisco IOS Software, Version 16.12.4',
  mac: '00:11:22:33:44:55',
  uptimeSeconds: 60,
  stack: null,
  commands: ['show version'],
  unverified: false,
  ...over,
});
const drawn = (over: Partial<DeviceNodeData> = {}): DeviceNodeData => ({ label: 'Core switch', deviceType: 'switch', ...over }) as DeviceNodeData;

describe('what a device said, onto its fields', () => {
  it('fills model, every serial, software, hostname and MAC, and leaves the name alone', () => {
    const { patch, changed } = deviceInfoPatch(info(), drawn(), 1);
    expect(patch).toMatchObject({
      hostname: 'EXAMPLE-SW',
      model: 'C9300-48P',
      serial: 'FOC0000TEST, FOC0001TEST',
      osVersion: 'Cisco IOS Software, Version 16.12.4',
      mac: '00:11:22:33:44:55',
    });
    expect(patch.label).toBeUndefined();
    expect(changed).toEqual(['hostname', 'model', 'serial', 'software', 'MAC']);
    expect(patch.evidence?.serial).toMatchObject({ source: 'ssh:device info', seenAtMs: 1 });
  });

  it('keeps what was typed where the device did not say', () => {
    const { patch, changed } = deviceInfoPatch(
      info({ model: null, serials: [], software: null, mac: null }),
      drawn({ model: 'typed model', serial: 'TYPED0000' }),
      1,
    );
    expect('model' in patch).toBe(false);
    expect('serial' in patch).toBe(false);
    expect(changed).toEqual(['hostname']);
  });

  it('says nothing changed when the device repeats what is there', () => {
    const first = deviceInfoPatch(info(), drawn(), 1).patch;
    expect(deviceInfoPatch(info(), drawn(first), 2).changed).toEqual([]);
  });

  it('lists a stack, a member a line with its serial', () => {
    const stack = { kind: 'stack-wise', members: [{ id: '1', role: 'active', serial: 'FOC0000TEST' }, { id: '2', role: 'standby', serial: 'FOC0001TEST' }], unverified: true } as unknown as DeviceInfo['stack'];
    const { patch } = deviceInfoPatch(info({ stack }), drawn(), 1);
    expect(patch.stackKind).toBe('StackWise');
    expect(patch.stackMembers).toBe('1 active FOC0000TEST\n2 standby FOC0001TEST');
    expect(patch.stackUnverified).toBe(true);
  });
});
