import { describe, expect, it } from 'vitest';
import { clearDrawnMarks, drawnLegend, drawnMark, fillDrawnLinks, isManagementPort, mediaOf, type DeviceReading } from './drawnLinks';
import { strokeFor } from './linkStyle';
import type { Neighbor } from './ipc';
import type { TopoEdge, TopoNode } from '../state/store';
import type { DeviceNodeData, LinkData } from '../types/domain';

const node = (id: string, label: string, over: Partial<DeviceNodeData> = {}): TopoNode =>
  ({ id, type: 'device', position: { x: 0, y: 0 }, data: { label, deviceType: 'core-switch', tags: [], addresses: [], ...over } }) as never;
const link = (id: string, source: string, target: string, over: Partial<LinkData> = {}): TopoEdge =>
  ({ id, source, target, type: 'live', data: { sourcePortLabel: '', targetPortLabel: '', label: '', enabled: true, maintenance: false, healthRule: { type: 'manual' }, ...over } }) as never;
const says = (name: string, local: string, remote: string, over: Partial<Neighbor> = {}): Neighbor =>
  ({ deviceId: name, shortName: name.split('.')[0], serial: null, addresses: [], localInterface: local, remoteInterface: remote, platform: null, capabilities: [], version: null, class: 'switch', discoveredBy: 'cdp', chassisId: null, vendor: null, ...over }) as never;
const reading = (nodeId: string, neighbors: Neighbor[], ports: DeviceReading['ports'] = []): DeviceReading => ({ nodeId, neighbors, ports });
let n = 0;
const id = () => `new-${++n}`;
const dataOf = (edges: TopoEdge[], edgeId: string) => edges.find((e) => e.id === edgeId)!.data as LinkData;

const SPINE = node('sp', 'SPINE-1');
const LEAF = node('lf', 'LEAF-1');
const MGMT = node('mg', 'MGMT-SW', { deviceType: 'access-switch' });

describe('a drawn link the devices confirm', () => {
  it('takes its port at each end, the way round it was drawn', () => {
    const drawn = [link('e1', 'lf', 'sp')];
    const got = fillDrawnLinks([SPINE, LEAF], drawn, [reading('sp', [says('LEAF-1.example.net', 'Ethernet1/1', 'Ethernet1/49')])], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/49', targetPortLabel: 'Eth1/1', drawnCheck: 'met' });
    expect(got).toMatchObject({ met: 1, unmet: 0, added: 0, undrawn: 0 });
  });

  it('is one cable however many of its ends report it', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Ethernet1/49')]),
      reading('lf', [says('SPINE-1', 'Ethernet1/49', 'Ethernet1/1')]),
    ], id);
    expect(got).toMatchObject({ met: 1, undrawn: 0, added: 0 });
  });

  it('two drawn links between two devices take the two cables, one each', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf'), link('e2', 'sp', 'lf')], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Ethernet1/49'), says('LEAF-1', 'Ethernet1/2', 'Ethernet1/50')]),
    ], id);
    expect([dataOf(got.edges, 'e1').sourcePortLabel, dataOf(got.edges, 'e2').sourcePortLabel].sort()).toEqual(['Eth1/1', 'Eth1/2']);
    expect(got.met).toBe(2);
  });

  it('a link that already names its port stays on that port', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf'), link('e2', 'sp', 'lf', { sourcePortLabel: 'Eth1/1' })], [
      reading('sp', [says('LEAF-1', 'Ethernet1/2', 'Ethernet1/50'), says('LEAF-1', 'Ethernet1/1', 'Ethernet1/49')]),
    ], id);
    expect(dataOf(got.edges, 'e2')).toMatchObject({ sourcePortLabel: 'Eth1/1', targetPortLabel: 'Eth1/49' });
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/2', targetPortLabel: 'Eth1/50' });
  });

  it('a device is known by its serial whatever it is called on the page', () => {
    const got = fillDrawnLinks([SPINE, node('lf', 'Leaf one', { serial: 'FDO0000TES1' })], [link('e1', 'sp', 'lf')], [
      reading('sp', [says('LEAF-1(FDO0000TES1)', 'Ethernet1/1', 'Ethernet1/49', { shortName: 'LEAF-1', serial: 'FDO0000TES1' })]),
    ], id);
    expect(got.met).toBe(1);
  });

  it('or by its hostname, or the address it is managed on', () => {
    const byHost = fillDrawnLinks([SPINE, node('lf', 'Leaf one', { hostname: 'LEAF-1' })], [link('e1', 'sp', 'lf')], [reading('sp', [says('LEAF-1', 'Eth1/1', 'Eth1/49')])], id);
    expect(byHost.met).toBe(1);
    const at = node('lf', 'Leaf one', { addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.11', isPrimary: true }] });
    const byAddress = fillDrawnLinks([SPINE, at], [link('e1', 'sp', 'lf')], [reading('sp', [says('SOMETHING-ELSE', 'Eth1/1', 'Eth1/49', { addresses: [{ ip: '192.0.2.11', interface: null, isManagement: true }] })])], id);
    expect(byAddress.met).toBe(1);
  });

  it('a neighbour with another chassis\'s serial is not the drawn device of the same address', () => {
    const at = node('lf', 'Leaf one', { serial: 'FDO0000TES1', addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.11', isPrimary: true }] });
    const got = fillDrawnLinks([SPINE, at], [link('e1', 'sp', 'lf')], [reading('sp', [says('OTHER', 'Eth1/1', 'Eth1/49', { serial: 'FDO0000TES9', addresses: [{ ip: '192.0.2.11', interface: null, isManagement: true }] })])], id);
    expect(got).toMatchObject({ met: 0, unmet: 1, strangers: 1 });
  });
});

describe('a drawn link no device reports', () => {
  it('is marked not found when one of its ends was asked', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [reading('sp', [])], id);
    expect(dataOf(got.edges, 'e1').drawnCheck).toBe('unmet');
    expect(got).toMatchObject({ met: 0, unmet: 1, unasked: 0 });
  });

  it('is left exactly as it was when neither end could be asked', () => {
    const drawn = [link('e1', 'sp', 'lf', { sourcePortLabel: 'typed' })];
    const got = fillDrawnLinks([SPINE, LEAF, MGMT], drawn, [reading('mg', [])], id);
    expect(got.edges).toBe(drawn);
    expect(got).toMatchObject({ unmet: 0, unasked: 1 });
  });

  it('found on a later asking, it is no longer marked', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf', { drawnCheck: 'unmet' })], [reading('sp', [says('LEAF-1', 'Eth1/1', 'Eth1/49')])], id);
    expect(dataOf(got.edges, 'e1').drawnCheck).toBe('met');
  });

  it('is kept, never removed, and drawn as a logical link', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf', { label: 'for the picture' })], [reading('sp', [])], id);
    expect(got.edges.length).toBe(1);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ label: 'for the picture', drawnCheck: 'unmet' });
    expect(strokeFor(dataOf(got.edges, 'e1'), 'unknown').dash).toBe(strokeFor({ linkKind: 'logical' }, 'unknown').dash);
    // A kind somebody chose for it is still theirs.
    expect(strokeFor({ drawnCheck: 'unmet', linkKind: 'tunnel' }, 'unknown').dash).toBe(strokeFor({ linkKind: 'tunnel' }, 'unknown').dash);
  });

  it('one drawn as a logical link on purpose is not checked at all', () => {
    const drawn = [link('e1', 'sp', 'lf', { linkKind: 'logical' })];
    const got = fillDrawnLinks([SPINE, LEAF], drawn, [reading('sp', [])], id);
    expect(got.edges).toBe(drawn);
    expect(got.unmet).toBe(0);
  });

  it('a note\'s leader, a tunnel and a routed hop are not checked', () => {
    const drawn = [link('l', 'sp', 'lf', { kind: 'leader' }), link('t', 'sp', 'lf', { overlay: true }), link('r', 'sp', 'lf', { layer3: true })];
    const got = fillDrawnLinks([SPINE, LEAF], drawn, [reading('sp', [])], id);
    expect(got.edges).toBe(drawn);
    expect(got.unmet).toBe(0);
  });
});

describe('nothing is discovered', () => {
  it('a neighbour that is not on the page is not put on it', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [reading('sp', [says('LEAF-1', 'Eth1/1', 'Eth1/49'), says('NOT-DRAWN', 'Eth1/9', 'Eth1/1')])], id);
    expect(got.edges.length).toBe(1);
    expect(got.strangers).toBe(1);
  });

  it('a cable between two drawn devices that nobody drew is drawn, its ports filled in', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [reading('sp', [says('LEAF-1', 'Eth1/1', 'Eth1/49'), says('LEAF-1', 'Eth1/2', 'Eth1/50')])], id);
    expect(got.edges.length).toBe(2);
    expect(got).toMatchObject({ met: 1, undrawn: 0, added: 1, management: 0 });
    const added = got.edges.find((e) => e.id !== 'e1')!;
    expect([added.source, added.target]).toEqual(['sp', 'lf']);
    expect(added.data).toMatchObject({ sourcePortLabel: 'Eth1/2', targetPortLabel: 'Eth1/50', drawnCheck: 'met', direction: 'none' });
    expect((added.data as LinkData).linkKind).toBeUndefined();
  });

  it('two devices that are cabled and have nothing drawn between them are joined', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [], [reading('lf', [says('SPINE-1', 'Ethernet1/49', 'Ethernet1/1')])], id);
    expect(got).toMatchObject({ added: 1, met: 0 });
    expect(got.edges[0]!.data).toMatchObject({ sourcePortLabel: 'Eth1/49', targetPortLabel: 'Eth1/1' });
  });
});

describe('management links', () => {
  it('one the devices report is drawn, as a management link, though nobody drew it', () => {
    const got = fillDrawnLinks([LEAF, MGMT], [], [reading('mg', [says('LEAF-1', 'GigabitEthernet1/0/11', 'mgmt0')])], id);
    expect(got).toMatchObject({ added: 1, management: 1 });
    const made = got.edges[0]!;
    expect([made.source, made.target]).toEqual(['mg', 'lf']);
    expect(made.data).toMatchObject({ linkKind: 'management', sourcePortLabel: 'Gi1/0/11', targetPortLabel: 'mgmt0', drawnCheck: 'met' });
  });

  it('asked again, it is not drawn a second time', () => {
    const readings = [reading('mg', [says('LEAF-1', 'GigabitEthernet1/0/11', 'mgmt0')])];
    const first = fillDrawnLinks([LEAF, MGMT], [], readings, id);
    const again = fillDrawnLinks([LEAF, MGMT], first.edges, readings, id);
    expect(again.edges.length).toBe(1);
    expect(again.added).toBe(0);
  });

  it('a link drawn between two switches is their cable, and the management port is drawn beside it', () => {
    const got = fillDrawnLinks([LEAF, MGMT], [link('e1', 'lf', 'mg')], [
      reading('mg', [says('LEAF-1', 'GigabitEthernet1/0/11', 'mgmt0'), says('LEAF-1', 'TenGigabitEthernet1/1/1', 'Ethernet1/48')]),
    ], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/48', targetPortLabel: 'Te1/1/1' });
    expect(dataOf(got.edges, 'e1').linkKind).toBeUndefined();
    expect(got.edges.length).toBe(2);
    expect(got.edges[1]!.data).toMatchObject({ linkKind: 'management' });
  });

  it('what a management port is', () => {
    for (const p of ['mgmt0', 'Mgmt0', 'Management1', 'Ma1', 'fxp0', 'me0', 'em0', 'oob']) expect(isManagementPort(p, false), p).toBe(true);
    for (const p of ['Eth1/1', 'Gi1/0/1', 'Te1/1/1', 'Vlan10', 'mem1x', '']) expect(isManagementPort(p, true), p).toBe(false);
    // The chassis's out-of-band port on a switch; an ordinary port on a router.
    expect(isManagementPort('Gi0/0', true)).toBe(true);
    expect(isManagementPort('GigabitEthernet0/0', true)).toBe(true);
    expect(isManagementPort('Gi0/0', false)).toBe(false);
  });
});

describe('what a port is made of', () => {
  it('from what the device calls the thing in it', () => {
    expect(mediaOf('10/100/1000BaseTX', 'Gi1/0/1')).toBe('ethernet');
    expect(mediaOf('1000base-T', 'Eth1/1')).toBe('ethernet');
    expect(mediaOf('SFP-10GBase-SR', 'Te1/1/1')).toBe('sfp');
    expect(mediaOf('10Gbase-SR', 'Eth1/49')).toBe('sfp');
    expect(mediaOf('1000BaseSX SFP', 'Gi1/1/1')).toBe('sfp');
    expect(mediaOf('QSFP-100G-SR4', 'Eth1/53')).toBe('qsfp');
    expect(mediaOf('100Gbase-SR4', 'Eth1/53')).toBe('qsfp');
    expect(mediaOf('QSFP 40G CU3M', 'Fo1/1/1')).toBe('qsfp');
  });

  it('or, where it says nothing, from what the port is called', () => {
    expect(mediaOf('', 'GigabitEthernet1/0/3')).toBe('ethernet');
    expect(mediaOf('--', 'TenGigabitEthernet1/1/1')).toBe('sfp');
    expect(mediaOf(undefined, 'TwentyFiveGigE1/0/1')).toBe('sfp');
    expect(mediaOf('unknown', 'HundredGigE1/0/49')).toBe('qsfp');
    expect(mediaOf('Not Present', 'FortyGigabitEthernet1/1/1')).toBe('qsfp');
    expect(mediaOf('', 'mgmt0')).toBe('ethernet');
  });

  it('and is not guessed where neither says', () => {
    expect(mediaOf('--', 'Ethernet1/49')).toBeNull();
    expect(mediaOf('', '')).toBeNull();
  });

  it('a confirmed link carries it, from either end\'s port table', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Ethernet1/49')], [{ port: 'Eth1/1', media: 'QSFP-100G-SR4', speed: '100G' }]),
    ], id);
    expect(dataOf(got.edges, 'e1').media).toBe('qsfp');
  });
});

describe('the marks', () => {
  it('not found beats everything; management beats what the port is made of', () => {
    expect(drawnMark({ drawnCheck: 'unmet', linkKind: 'management', media: 'sfp' })).toBe('unmet');
    expect(drawnMark({ drawnCheck: 'met', linkKind: 'management', media: 'ethernet' })).toBe('management');
    expect(drawnMark({ drawnCheck: 'met', media: 'sfp' })).toBe('sfp');
    expect(drawnMark({ media: 'sfp' })).toBeNull();
    expect(drawnMark({})).toBeNull();
  });

  it('the legend lists only what is on the page, with how many', () => {
    const edges = [link('a', 'x', 'y', { drawnCheck: 'met', media: 'sfp' }), link('b', 'x', 'y', { drawnCheck: 'met', media: 'sfp' }), link('c', 'x', 'y', { drawnCheck: 'unmet' }), link('d', 'x', 'y')];
    expect(drawnLegend(edges)).toEqual([{ key: 'sfp', count: 2 }, { key: 'unmet', count: 1 }]);
    expect(drawnLegend([link('d', 'x', 'y')])).toEqual([]);
  });

  it('are taken off again, and the ports stay', () => {
    const edges = [link('a', 'x', 'y', { drawnCheck: 'met', media: 'sfp', sourcePortLabel: 'Te1/1/1' }), link('d', 'x', 'y')];
    const got = clearDrawnMarks(edges);
    expect(got.cleared).toBe(1);
    expect(got.edges[0]!.data).toMatchObject({ sourcePortLabel: 'Te1/1/1' });
    expect('drawnCheck' in (got.edges[0]!.data as object)).toBe(false);
    expect(got.edges[1]).toBe(edges[1]);
    expect(clearDrawnMarks([edges[1]!]).edges.length).toBe(1);
  });
});

describe('where CDP and LLDP say nothing: by MAC address', () => {
  // A firewall speaks neither protocol. The switch's MAC table says which
  // of its ports learned which address; the firewall's own interfaces say
  // whose address that is.
  const SW = node('sw', 'ACCESS-SW', { deviceType: 'access-switch', addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.2', isPrimary: true }] });
  const FW = node('fw', 'FTD-1', { deviceType: 'firewall', addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.10', isPrimary: true }] });
  const SRV = node('sv', 'SERVER-1', { deviceType: 'server', addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.20', isPrimary: true }] });
  const switchSays = (macs: { port: string; mac: string }[], over: Partial<DeviceReading> = {}): DeviceReading => ({ ...reading('sw', []), macs, ...over });
  const ftdSays = (own: { port: string; mac: string }[]): DeviceReading => ({ ...reading('fw', []), own });

  it('fills in a drawn link from the port that learned the firewall\'s address', () => {
    const got = fillDrawnLinks([SW, FW], [link('e1', 'fw', 'sw')], [
      switchSays([{ port: 'GigabitEthernet1/0/5', mac: '00a6cafe0002' }, { port: 'GigabitEthernet1/0/7', mac: '5254000000aa' }]),
      ftdSays([{ port: 'Ethernet1/1', mac: '00a6cafe0001' }, { port: 'Ethernet1/2', mac: '00a6cafe0002' }]),
    ], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/2', targetPortLabel: 'Gi1/0/5', drawnCheck: 'met', drawnVia: 'mac' });
    expect(got).toMatchObject({ met: 1, byMac: 1 });
  });

  it('draws the cable when nobody had', () => {
    const got = fillDrawnLinks([SW, FW], [], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0002' }]), ftdSays([{ port: 'Ethernet1/2', mac: '00a6cafe0002' }])], id);
    expect(got).toMatchObject({ added: 1, byMac: 1 });
    expect(got.edges[0]!.data).toMatchObject({ drawnVia: 'mac', drawnCheck: 'met' });
  });

  it('finds a device it could not log in to through an ARP table, its own port left blank', () => {
    const got = fillDrawnLinks([SW, FW], [link('e1', 'sw', 'fw')], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0002' }], { arp: [{ ip: '192.0.2.10', mac: '00a6cafe0002' }] })], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Gi1/0/5', targetPortLabel: '', drawnVia: 'mac' });
  });

  it('a port that learned two drawn devices is between switches, and joins neither', () => {
    const got = fillDrawnLinks([SW, FW, SRV], [], [
      switchSays([{ port: 'Te1/1/1', mac: '00a6cafe0002' }, { port: 'Te1/1/1', mac: '5254000000bb' }]),
      ftdSays([{ port: 'Ethernet1/2', mac: '00a6cafe0002' }]),
      { ...reading('sv', []), own: [{ port: 'eth0', mac: '5254000000bb' }] },
    ], id);
    expect(got).toMatchObject({ added: 0, byMac: 0 });
  });

  it('a port that learned many addresses is an uplink, and joins nothing', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ port: 'Te1/1/1', mac: `5254000001${String(i).padStart(2, '0')}` }));
    const got = fillDrawnLinks([SW, FW], [], [switchSays([...many, { port: 'Te1/1/1', mac: '00a6cafe0002' }]), ftdSays([{ port: 'Ethernet1/2', mac: '00a6cafe0002' }])], id);
    expect(got.added).toBe(0);
  });

  it('a port a neighbour protocol already named is left to it', () => {
    const got = fillDrawnLinks([SW, FW], [], [
      switchSays([{ port: 'GigabitEthernet1/0/5', mac: '00a6cafe0002' }], { neighbors: [says('FTD-1', 'GigabitEthernet1/0/5', 'Ethernet1/2')] }),
      ftdSays([{ port: 'Ethernet1/2', mac: '00a6cafe0002' }]),
    ], id);
    expect(got).toMatchObject({ added: 1, byMac: 0 });
    expect((got.edges[0]!.data as LinkData).drawnVia).toBeUndefined();
  });

  it('where every interface shares one address, the firewall\'s port is not guessed', () => {
    const got = fillDrawnLinks([SW, FW], [], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0001' }]), ftdSays([{ port: 'Ethernet1/1', mac: '00a6cafe0001' }, { port: 'Ethernet1/2', mac: '00a6cafe0001' }])], id);
    expect(got.edges[0]!.data).toMatchObject({ sourcePortLabel: 'Gi1/0/5', targetPortLabel: '' });
  });

  it('the mark comes off with the others', () => {
    const got = clearDrawnMarks([link('a', 'x', 'y', { drawnCheck: 'met', drawnVia: 'mac', sourcePortLabel: 'Gi1/0/5' })]);
    expect('drawnVia' in (got.edges[0]!.data as object)).toBe(false);
  });
});
