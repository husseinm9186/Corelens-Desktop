import { describe, expect, it } from 'vitest';
import { deviceInfoPatch, fillDeviceInfo } from './deviceInfo';
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
  addresses: [],
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

  it('lists its own interface addresses under its checks, the one dialled as primary', () => {
    const had = drawn({ addresses: [{ id: 'mine', label: 'Mgmt', address: '192.0.2.10', isPrimary: true }] });
    const said = info({ addresses: [{ ip: '192.0.2.10', interface: 'Vlan10', isManagement: true }, { ip: '198.51.100.1', interface: 'Vlan20', isManagement: false }] });
    const { patch, changed } = deviceInfoPatch(said, had, 1, '192.0.2.10');
    expect(patch.addresses?.map((a) => [a.label, a.address, a.isPrimary])).toEqual([['Mgmt', '192.0.2.10', true], ['Vlan20', '198.51.100.1', false]]);
    expect(changed).toContain('interface addresses');
    // And a second reading adds nothing.
    const again = deviceInfoPatch(said, drawn({ ...patch } as never), 2, '192.0.2.10');
    expect(again.changed).toEqual([]);
    expect('addresses' in again.patch).toBe(false);
  });

  it('lists a stack, a member a line with its serial', () => {
    const stack = { kind: 'stack-wise', members: [{ id: '1', role: 'active', serial: 'FOC0000TEST' }, { id: '2', role: 'standby', serial: 'FOC0001TEST' }], unverified: true } as unknown as DeviceInfo['stack'];
    const { patch } = deviceInfoPatch(info({ stack }), drawn(), 1);
    expect(patch.stackKind).toBe('StackWise');
    expect(patch.stackMembers).toBe('1 active FOC0000TEST\n2 standby FOC0001TEST');
    expect(patch.stackUnverified).toBe(true);
  });
});

describe('what a device said, onto every drawing of it', () => {
  const at = (address: string, over: Partial<DeviceNodeData> = {}) =>
    drawn({ addresses: [{ id: `a-${address}`, label: 'Mgmt', address, isPrimary: true }], ...over });
  const node = (id: string, data: DeviceNodeData) => ({ id, type: 'device', position: { x: 0, y: 0 }, data }) as never;
  const pages = () =>
    [
      { id: 'p1', name: 'Core', nodes: [node('n1', at('192.0.2.10')), node('n2', at('192.0.2.11'))], edges: [] },
      { id: 'p2', name: 'Site', nodes: [node('n3', at('192.0.2.10/24', { label: 'Core, again' })), { id: 'note', type: 'note', position: { x: 0, y: 0 }, data: { text: '192.0.2.10' } }], edges: [] },
    ] as never as Parameters<typeof fillDeviceInfo>[0];
  const modelOf = (ps: ReturnType<typeof pages>, id: string) =>
    (ps.flatMap((p) => p.nodes).find((n) => n.id === id)!.data as DeviceNodeData).model;

  it('fills the device asked and every other drawing managed on the same address', () => {
    const got = fillDeviceInfo(pages(), 'n1', info(), 1, '192.0.2.10');
    expect(got.filled).toEqual(['n1', 'n3']);
    expect(modelOf(got.pages, 'n1')).toBe('C9300-48P');
    expect(modelOf(got.pages, 'n3')).toBe('C9300-48P');
    expect(got.changed).toContain('model');
  });

  it('leaves another device, and a note, alone', () => {
    const before = pages();
    const got = fillDeviceInfo(before, 'n1', info(), 1, '192.0.2.10');
    expect(modelOf(got.pages, 'n2')).toBeUndefined();
    expect(got.pages[1]!.nodes[1]).toEqual(before[1]!.nodes[1]);
    expect((got.pages[1]!.nodes[0]!.data as DeviceNodeData).label).toBe('Core, again');
  });

  it('does not care which page the device is on', () => {
    const got = fillDeviceInfo(pages(), 'n3', info(), 1, '192.0.2.10');
    expect(got.filled).toEqual(['n1', 'n3']);
  });

  it('fills nothing only when the device is on no page at all', () => {
    const before = pages();
    const got = fillDeviceInfo(before, 'deleted', info(), 1, '192.0.2.99');
    expect(got.filled).toEqual([]);
    expect(got.pages).toBe(before);
  });

  it('a page nothing on was filled is the same page as before', () => {
    const before = pages().concat([{ id: 'p3', name: 'Other', nodes: [], edges: [] }] as never);
    expect(fillDeviceInfo(before, 'n1', info(), 1, '192.0.2.10').pages[2]).toBe(before[2]);
  });
});
