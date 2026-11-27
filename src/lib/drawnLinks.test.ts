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

  it('is not enough to draw a cable nobody drew', () => {
    const got = fillDrawnLinks([SW, FW], [], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0002' }]), ftdSays([{ port: 'Ethernet1/2', mac: '00a6cafe0002' }])], id);
    expect(got).toMatchObject({ added: 0, byMac: 0, unsure: 1 });
  });

  it('a firewall that could not be asked is not found: whose an address is comes only from the device itself', () => {
    const got = fillDrawnLinks([SW, FW], [link('e1', 'sw', 'fw')], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0002' }])], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ drawnCheck: 'unmet', sourcePortLabel: '' });
    expect(got.byMac).toBe(0);
  });

  it('is for a firewall or a router, never for a switch or anything else', () => {
    const own = [{ port: 'Ethernet1/2', mac: '00a6cafe0002' }];
    const told = (deviceType: string) => {
      const far = node('fw', 'FAR', { deviceType: deviceType as never, addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.10', isPrimary: true }] });
      const got = fillDrawnLinks([SW, far], [link('e1', 'sw', 'fw')], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0002' }]), { ...reading('fw', []), own }], id);
      return dataOf(got.edges, 'e1').drawnVia === 'mac';
    };
    expect(told('firewall')).toBe(true);
    expect(told('router')).toBe(true);
    // A leaf has the anycast gateway's address like every other leaf.
    for (const kind of ['access-switch', 'core-switch', 'l3-switch', 'server', 'generic']) expect(told(kind), kind).toBe(false);
  });

  it('a port that learned two drawn firewalls is between switches, and joins neither', () => {
    const fw2 = node('f2', 'FTD-2', { deviceType: 'firewall', addresses: [{ id: 'a', label: 'Mgmt', address: '192.0.2.11', isPrimary: true }] });
    const got = fillDrawnLinks([SW, FW, fw2], [link('e1', 'sw', 'fw'), link('e2', 'sw', 'f2')], [
      switchSays([{ port: 'Te1/1/1', mac: '00a6cafe0002' }, { port: 'Te1/1/1', mac: '00a6cafe00bb' }]),
      ftdSays([{ port: 'Ethernet1/2', mac: '00a6cafe0002' }]),
      { ...reading('f2', []), own: [{ port: 'Ethernet1/2', mac: '00a6cafe00bb' }] },
    ], id);
    expect(got).toMatchObject({ added: 0, byMac: 0, unmet: 2 });
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
    const got = fillDrawnLinks([SW, FW], [link('e1', 'sw', 'fw')], [switchSays([{ port: 'Gi1/0/5', mac: '00a6cafe0001' }]), ftdSays([{ port: 'Ethernet1/1', mac: '00a6cafe0001' }, { port: 'Ethernet1/2', mac: '00a6cafe0001' }])], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Gi1/0/5', targetPortLabel: '', drawnVia: 'mac' });
  });

  it('the mark comes off with the others', () => {
    const got = clearDrawnMarks([link('a', 'x', 'y', { drawnCheck: 'met', drawnVia: 'mac', sourcePortLabel: 'Gi1/0/5' })]);
    expect('drawnVia' in (got.edges[0]!.data as object)).toBe(false);
  });
});

describe('a far port that is a description rather than a name', () => {
  // LLDP sends a port's description where one is configured, so each end
  // names its own port and describes the other's in free text.
  it('is one cable, each end naming its own port', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Uplink to core', { discoveredBy: 'lldp' })]),
      reading('lf', [says('SPINE-1', 'Ethernet1/49', 'to access', { discoveredBy: 'lldp' })]),
    ], id);
    expect(got).toMatchObject({ met: 1, added: 0 });
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/1', targetPortLabel: 'Eth1/49' });
  });

  it('with nothing drawn, one link is drawn for it and not two', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Uplink to core', { discoveredBy: 'lldp' })]),
      reading('lf', [says('SPINE-1', 'Ethernet1/49', 'to access', { discoveredBy: 'lldp' })]),
    ], id);
    expect(got.added).toBe(1);
    expect(got.edges[0]!.data).toMatchObject({ sourcePortLabel: 'Eth1/1', targetPortLabel: 'Eth1/49' });
  });

  it('two such cables are two, and which far port is whose is not guessed', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'leaf a', { discoveredBy: 'lldp' }), says('LEAF-1', 'Ethernet1/2', 'leaf b', { discoveredBy: 'lldp' })]),
      reading('lf', [says('SPINE-1', 'Ethernet1/49', 'spine a', { discoveredBy: 'lldp' }), says('SPINE-1', 'Ethernet1/50', 'spine b', { discoveredBy: 'lldp' })]),
    ], id);
    expect(got.added).toBe(2);
    const ports = got.edges.map((e) => (e.data as LinkData).sourcePortLabel).sort();
    expect(ports).toEqual(['Eth1/1', 'Eth1/2']);
    expect(got.edges.map((e) => (e.data as LinkData).targetPortLabel).some((p) => /^Eth1\/(49|50)$/.test(p ?? ''))).toBe(false);
  });

  it('where only one end could be asked, what it said of the far port is kept', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Uplink to core', { discoveredBy: 'lldp' })])], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/1', targetPortLabel: 'Uplink to core' });
  });

  it('a far port the other end has, though it did not report the cable, is still its name', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf')], [
      reading('sp', [says('LEAF-1', 'Ethernet1/1', 'Ethernet1/49')]),
      reading('lf', [], [{ port: 'Ethernet1/50', media: '10Gbase-SR', speed: '10G' }]),
    ], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/1', targetPortLabel: 'Eth1/49' });
  });
});

describe('a device drawn twice on one page', () => {
  const at = (address: string) => ({ addresses: [{ id: 'a', label: 'Mgmt', address, isPrimary: true }] });
  const CORE_A = node('c1', 'CORE', at('192.0.2.1'));
  const CORE_B = node('c2', 'CORE', at('192.0.2.1'));
  const ACC = node('ac', 'ACCESS', at('192.0.2.2'));
  // One reading per drawing, which is how they are gathered.
  const readings = [
    reading('c1', [says('ACCESS', 'Ethernet1/1', 'Ethernet1/49')]),
    reading('c2', [says('ACCESS', 'Ethernet1/1', 'Ethernet1/49')]),
    reading('ac', [says('CORE', 'Ethernet1/49', 'Ethernet1/1')]),
  ];

  it('is one device: its cable is confirmed once and not drawn again from the twin', () => {
    const got = fillDrawnLinks([CORE_A, CORE_B, ACC], [link('e1', 'c1', 'ac')], readings, id);
    expect(got).toMatchObject({ met: 1, added: 0 });
  });

  it('a link drawn to the second drawing is the same cable', () => {
    const got = fillDrawnLinks([CORE_A, CORE_B, ACC], [link('e1', 'ac', 'c2')], readings, id);
    expect(got).toMatchObject({ met: 1, added: 0, unmet: 0 });
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Eth1/49', targetPortLabel: 'Eth1/1' });
  });
});

describe('by MAC address, more carefully', () => {
  const at = (address: string) => ({ addresses: [{ id: 'a', label: 'Mgmt', address, isPrimary: true }] });
  const SW1 = node('s1', 'DIST-SW', { deviceType: 'distribution-switch', ...at('192.0.2.2') });
  const SW2 = node('s2', 'ACCESS-SW', { deviceType: 'access-switch', ...at('192.0.2.3') });
  const FW = node('fw', 'FTD-1', { deviceType: 'firewall', ...at('192.0.2.10') });
  const fwOwn: DeviceReading = { ...reading('fw', []), own: [{ port: 'Ethernet1/2', mac: '00a6cafe0002' }] };

  it('one address is one cable: a second switch that learned it on its uplink is not cabled to the firewall', () => {
    const got = fillDrawnLinks([SW1, SW2, FW], [link('e1', 's1', 'fw'), link('e2', 's2', 'fw')], [
      { ...reading('s1', [says('ACCESS-SW', 'GigabitEthernet1/0/49', 'GigabitEthernet1/0/1')]), macs: [{ port: 'Gi1/0/5', mac: '00a6cafe0002' }] },
      // The uplink is a bundle the MAC table names and CDP does not.
      { ...reading('s2', [says('DIST-SW', 'GigabitEthernet1/0/1', 'GigabitEthernet1/0/49')]), macs: [{ port: 'Po1', mac: '00a6cafe0002' }, { port: 'Po1', mac: '5254000000aa' }] },
      fwOwn,
    ], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Gi1/0/5', drawnCheck: 'met', drawnVia: 'mac' });
    // The link drawn to the second switch is kept, as what it then is.
    expect(dataOf(got.edges, 'e2')).toMatchObject({ sourcePortLabel: '', drawnCheck: 'unmet' });
    expect(got).toMatchObject({ byMac: 1, added: 1 });
  });

  it('where two switches learned it on ports that look alike, neither is guessed', () => {
    const got = fillDrawnLinks([SW1, SW2, FW], [link('e1', 's1', 'fw'), link('e2', 's2', 'fw')], [
      { ...reading('s1', []), macs: [{ port: 'Gi1/0/5', mac: '00a6cafe0002' }] },
      { ...reading('s2', []), macs: [{ port: 'Gi1/0/1', mac: '00a6cafe0002' }] },
      fwOwn,
    ], id);
    expect(got).toMatchObject({ added: 0, byMac: 0, met: 0, unmet: 2 });
  });

  it('a bundle to a pair of switches is a cable to each, where the firewall has the interfaces for it', () => {
    const got = fillDrawnLinks([SW1, SW2, FW], [link('e1', 's1', 'fw'), link('e2', 's2', 'fw')], [
      { ...reading('s1', []), macs: [{ port: 'Po10', mac: '00a6cafe0002' }] },
      { ...reading('s2', []), macs: [{ port: 'Po10', mac: '00a6cafe0002' }] },
      { ...reading('fw', []), own: [{ port: 'Port-channel1', mac: '00a6cafe0002' }, { port: 'Ethernet1/1', mac: '00a6cafe0002' }, { port: 'Ethernet1/2', mac: '00a6cafe0002' }] },
    ], id);
    expect(got).toMatchObject({ met: 2, byMac: 2, added: 0 });
    expect(got.edges.map((e) => (e.data as LinkData).targetPortLabel)).toEqual(['', '']);
  });

  it('a logical interface never names the port', () => {
    const got = fillDrawnLinks([SW1, FW], [link('e1', 's1', 'fw')], [
      { ...reading('s1', []), macs: [{ port: 'Gi1/0/5', mac: '00a6cafe0002' }] },
      { ...reading('fw', []), own: [{ port: 'Vlan10', mac: '00a6cafe0002' }] },
    ], id);
    expect(got.edges[0]!.data).toMatchObject({ sourcePortLabel: 'Gi1/0/5', targetPortLabel: '' });
  });

  it('and does not stop the physical interface that shares its address from naming it', () => {
    const got = fillDrawnLinks([SW1, FW], [link('e1', 's1', 'fw')], [
      { ...reading('s1', []), macs: [{ port: 'Gi1/0/5', mac: '00a6cafe0002' }] },
      { ...reading('fw', []), own: [{ port: 'Ethernet1/2', mac: '00a6cafe0002' }, { port: 'BVI1', mac: '00a6cafe0002' }] },
    ], id);
    expect(got.edges[0]!.data).toMatchObject({ targetPortLabel: 'Eth1/2' });
  });

  it('a port somebody typed wins over one told by MAC address', () => {
    const got = fillDrawnLinks([SW1, FW], [link('e1', 's1', 'fw', { sourcePortLabel: 'Gi1/0/9', targetPortLabel: 'outside' })], [
      { ...reading('s1', []), macs: [{ port: 'Gi1/0/5', mac: '00a6cafe0002' }] },
      fwOwn,
    ], id);
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Gi1/0/9', targetPortLabel: 'outside', drawnCheck: 'met', drawnVia: 'mac' });
    expect(got.added).toBe(0);
  });
});

describe('a link made logical after it was marked', () => {
  it('carries no mark', () => {
    expect(drawnMark({ drawnCheck: 'unmet', linkKind: 'logical' })).toBeNull();
    expect(drawnMark({ drawnCheck: 'unmet', linkKind: 'tunnel' })).toBeNull();
    expect(drawnLegend([link('a', 'x', 'y', { drawnCheck: 'unmet', linkKind: 'logical' })])).toEqual([]);
  });

  it('and the next run takes the stale mark off', () => {
    const got = fillDrawnLinks([SPINE, LEAF], [link('e1', 'sp', 'lf', { drawnCheck: 'unmet', linkKind: 'logical' })], [reading('sp', [])], id);
    expect(dataOf(got.edges, 'e1').drawnCheck).toBeUndefined();
    expect(got.unmet).toBe(0);
  });
});

describe('who a reported neighbour is', () => {
  const at = (address: string) => ({ addresses: [{ id: 'a', label: 'Mgmt', address, isPrimary: true }] });
  const BGW = node('bg', 'BGW-01', at('192.0.2.23'));
  const SP1 = node('s1', 'SPINE-01', at('192.0.2.21'));
  const SP2 = node('s2', 'SPINE-02', at('192.0.2.22'));
  const LF1 = node('l1', 'LEAF-01', at('192.0.2.25'));
  const ends = (edges: TopoEdge[]) => edges.map((e) => [e.source, e.target].sort().join('-')).sort();

  it('a serial two differently named neighbours share identifies neither of them', () => {
    // Cloned virtual switches report one serial. The leaf it was once read
    // from must not become every device that reports it.
    const leaf = node('l1', 'LEAF-01', { ...at('192.0.2.25'), serial: '9CLONED0001' });
    const got = fillDrawnLinks([leaf, SP1, SP2, BGW], [link('e1', 'bg', 's1'), link('e2', 'bg', 's2')], [
      reading('bg', [
        says('SPINE-01(9CLONED0001)', 'Ethernet1/1', 'Ethernet1/49', { shortName: 'SPINE-01', serial: '9CLONED0001' }),
        says('SPINE-02(9CLONED0001)', 'Ethernet1/2', 'Ethernet1/49', { shortName: 'SPINE-02', serial: '9CLONED0001' }),
      ]),
    ], id);
    expect(got).toMatchObject({ met: 2, added: 0 });
    expect(ends(got.edges)).toEqual(['bg-s1', 'bg-s2']);
  });

  it('a serial that names one drawn device while the name names another is not guessed', () => {
    const leaf = node('l1', 'LEAF-01', { ...at('192.0.2.25'), serial: 'FDO0000TES9' });
    const got = fillDrawnLinks([leaf, SP1, BGW], [], [
      reading('bg', [says('SPINE-01(FDO0000TES9)', 'Ethernet1/1', 'Ethernet1/49', { shortName: 'SPINE-01', serial: 'FDO0000TES9' })]),
    ], id);
    expect(got).toMatchObject({ added: 0, unsure: 1 });
  });

  it('an address two differently named neighbours report identifies neither', () => {
    const got = fillDrawnLinks([LF1, BGW], [], [
      reading('bg', [
        says('DC-A', 'Ethernet1/1', 'Ethernet1/49', { addresses: [{ ip: '192.0.2.25' }] as never }),
        says('DC-B', 'Ethernet1/2', 'Ethernet1/49', { addresses: [{ ip: '192.0.2.25' }] as never }),
      ]),
    ], id);
    expect(got).toMatchObject({ added: 0, met: 0 });
  });

  it('matched by address alone, a cable confirms a link somebody drew and is never drawn by itself', () => {
    const core = node('co', 'Core switch', at('192.0.2.7'));
    const report = [reading('bg', [says('DC-CORE-7', 'Ethernet1/5', 'Ethernet2/1', { addresses: [{ ip: '192.0.2.7' }] as never })])];
    const drawn = fillDrawnLinks([core, BGW], [link('e1', 'bg', 'co')], report, id);
    expect(dataOf(drawn.edges, 'e1')).toMatchObject({ drawnCheck: 'met', sourcePortLabel: 'Eth1/5' });
    const bare = fillDrawnLinks([core, BGW], [], report, id);
    expect(bare).toMatchObject({ added: 0, unsure: 1 });
    expect(bare.edges).toHaveLength(0);
  });

  it('an address is refused where the device drawn there is known under another name', () => {
    const leaf = node('l1', 'LEAF-01', { ...at('192.0.2.25'), hostname: 'dc-leaf-01' });
    const got = fillDrawnLinks([leaf, BGW], [link('e1', 'bg', 'l1')], [
      reading('bg', [says('DC-SPINE-01', 'Ethernet1/1', 'Ethernet1/49', { addresses: [{ ip: '192.0.2.25' }] as never })]),
    ], id);
    expect(dataOf(got.edges, 'e1').drawnCheck).toBe('unmet');
  });

  it('what a device calls itself is a name for it, whatever it is called on the page', () => {
    const core = node('co', 'Core switch', at('192.0.2.7'));
    const got = fillDrawnLinks([core, BGW], [], [
      { ...reading('co', []), hostname: 'DC-CORE-7' },
      reading('bg', [says('DC-CORE-7.example.net', 'Ethernet1/5', 'Ethernet2/1', { shortName: 'DC-CORE-7' })]),
    ], id);
    expect(got.added).toBe(1);
    expect(ends(got.edges)).toEqual(['bg-co']);
  });

  it('two differently named devices drawn with one address are two devices', () => {
    // A copy of a spine relabelled as a leaf, its address never corrected.
    const copy = node('l1', 'LEAF-01', at('192.0.2.21'));
    const answer = { neighbors: [says('BGW-01', 'Ethernet1/1', 'Ethernet1/49')], ports: [], hostname: 'SPINE-01' };
    const got = fillDrawnLinks([copy, SP1, BGW], [link('e1', 's1', 'bg')], [{ nodeId: 'l1', ...answer }, { nodeId: 's1', ...answer }], id);
    expect(got).toMatchObject({ met: 1, added: 0 });
    expect(ends(got.edges)).toEqual(['bg-s1']);
    expect(got.misplaced).toEqual([{ label: 'LEAF-01', as: 'SPINE-01' }]);
  });

  it('an answer from a device that says it is another one on the page is counted as that one\'s', () => {
    const spine = node('s1', 'SPINE-01');
    const got = fillDrawnLinks([LF1, spine, BGW], [link('e1', 's1', 'bg')], [
      { ...reading('l1', [says('BGW-01', 'Ethernet1/1', 'Ethernet1/49')]), hostname: 'SPINE-01.example.net' },
    ], id);
    expect(got).toMatchObject({ met: 1, added: 0 });
    expect(got.misplaced).toEqual([{ label: 'LEAF-01', as: 'SPINE-01.example.net' }]);
  });

  it('devices sharing an address whose names say nothing of which answered are not asked', () => {
    const a = node('x1', 'Switch A', at('192.0.2.50'));
    const b = node('x2', 'Switch B', at('192.0.2.50'));
    const answer = { neighbors: [says('BGW-01', 'Ethernet1/1', 'Ethernet1/49')], ports: [], hostname: 'DC-EDGE-9' };
    const got = fillDrawnLinks([a, b, BGW], [], [{ nodeId: 'x1', ...answer }, { nodeId: 'x2', ...answer }], id);
    expect(got.added).toBe(0);
    expect(got.shared).toEqual(['Switch A', 'Switch B']);
  });

  it('every link it touches says who reported it and how the far device was matched', () => {
    const got = fillDrawnLinks([SP1, BGW], [link('e1', 'bg', 's1')], [reading('bg', [says('SPINE-01', 'Ethernet1/1', 'Ethernet1/49')])], id);
    expect(dataOf(got.edges, 'e1').drawnSaid).toEqual({ by: 'BGW-01', port: 'Eth1/1', saw: 'SPINE-01', sawPort: 'Eth1/49', match: 'name' });
    expect('drawnSaid' in (clearDrawnMarks(got.edges).edges[0]!.data as object)).toBe(false);
  });
});

describe('by MAC address, in a fabric', () => {
  const at = (address: string) => ({ addresses: [{ id: 'a', label: 'Mgmt', address, isPrimary: true }] });
  const LEAF = node('lf', 'LEAF-01', { deviceType: 'access-switch', ...at('192.0.2.25') });
  const FW = node('fw', 'FTD-1', { deviceType: 'firewall', ...at('192.0.2.10') });
  const fwOwn: DeviceReading = { ...reading('fw', []), own: [{ port: 'Ethernet1/2', mac: '00a6cafe0002' }] };

  it('an address learned over the overlay, a VLAN interface or the peer link is not on a cable', () => {
    for (const port of ['nve1(192.0.2.99)', 'Vlan10', 'vPC Peer-Link(R)', 'sup-eth1(R)']) {
      const got = fillDrawnLinks([LEAF, FW], [link('e1', 'lf', 'fw')], [{ ...reading('lf', []), macs: [{ port, mac: '00a6cafe0002' }] }, fwOwn], id);
      expect(dataOf(got.edges, 'e1').drawnCheck, port).toBe('unmet');
      expect(got.byMac, port).toBe(0);
    }
  });

  it('never draws a cable by itself: it fills in a link somebody drew', () => {
    const got = fillDrawnLinks([LEAF, FW], [], [{ ...reading('lf', []), macs: [{ port: 'Eth1/5', mac: '00a6cafe0002' }] }, fwOwn], id);
    expect(got).toMatchObject({ added: 0, byMac: 0, unsure: 1 });
    expect(got.edges).toHaveLength(0);
  });
});

describe('what is a cable, and what is not', () => {
  const at = (address: string) => ({ addresses: [{ id: 'a', label: 'Mgmt', address, isPrimary: true }] });
  const R1 = node('r1', 'EDGE-R1', { deviceType: 'router', ...at('192.0.2.1') });
  const R2 = node('r2', 'EDGE-R2', { deviceType: 'router', ...at('192.0.2.2') });
  const R3 = node('r3', 'EDGE-R3', { deviceType: 'router', ...at('192.0.2.3') });

  it('a neighbour seen over a tunnel, a VLAN interface or a loopback is an adjacency, not a cable', () => {
    for (const port of ['Tunnel10', 'Vlan100', 'Loopback0', 'nve1']) {
      const got = fillDrawnLinks([R1, R2], [link('e1', 'r1', 'r2')], [reading('r1', [says('EDGE-R2', port, port)])], id);
      expect(dataOf(got.edges, 'e1').drawnCheck, port).toBe('unmet');
      expect(fillDrawnLinks([R1, R2], [], [reading('r1', [says('EDGE-R2', port, port)])], id).added, port).toBe(0);
    }
  });

  it('a cable on a subinterface is the cable on its port', () => {
    const got = fillDrawnLinks([R1, R2], [link('e1', 'r1', 'r2')], [
      reading('r1', [says('EDGE-R2', 'GigabitEthernet0/0.100', 'GigabitEthernet0/1.100')]),
      reading('r2', [says('EDGE-R1', 'GigabitEthernet0/1', 'GigabitEthernet0/0')]),
    ], id);
    expect(got).toMatchObject({ met: 1, added: 0 });
    expect(dataOf(got.edges, 'e1')).toMatchObject({ sourcePortLabel: 'Gi0/0', targetPortLabel: 'Gi0/1' });
  });

  it('several neighbours on one port are a shared segment: it confirms a drawn link and draws none', () => {
    // A provider's layer-2 service, or a switch that passes CDP through.
    const sees = [reading('r1', [says('EDGE-R2', 'GigabitEthernet0/0', 'GigabitEthernet0/0'), says('EDGE-R3', 'GigabitEthernet0/0', 'GigabitEthernet0/0')])];
    const mesh = fillDrawnLinks([R1, R2, R3], [], sees, id);
    expect(mesh).toMatchObject({ added: 0, unsure: 2 });
    const drawn = fillDrawnLinks([R1, R2, R3], [link('e1', 'r1', 'r2')], sees, id);
    expect(dataOf(drawn.edges, 'e1')).toMatchObject({ drawnCheck: 'met', sourcePortLabel: 'Gi0/0' });
    expect(dataOf(drawn.edges, 'e1').drawnSaid?.segment).toBe(true);
    expect(drawn.added).toBe(0);
  });

  it('CDP and LLDP each naming the far device in their own words is one device, not a segment', () => {
    const got = fillDrawnLinks([R1, R2], [], [reading('r1', [
      says('EDGE-R2', 'GigabitEthernet0/0', 'GigabitEthernet0/1'),
      says('7456.3c00.0001', 'Gi0/0', '7456.3c00.0002', { discoveredBy: 'lldp', shortName: '7456.3c00.0001' }),
    ])], id);
    expect(got).toMatchObject({ added: 1, unsure: 0 });
    expect(got.edges[0]!.data).toMatchObject({ sourcePortLabel: 'Gi0/0', targetPortLabel: 'Gi0/1' });
  });

  it('one port, one cable: two reports that put two cables on one port of a device are neither believed', () => {
    // Two routers each say their neighbour's port is Gi0/0 of what was
    // matched to the same drawn device. At least one is someone else.
    const got = fillDrawnLinks([R1, R2, R3], [], [
      reading('r1', [says('EDGE-R3', 'GigabitEthernet0/1', 'GigabitEthernet0/0')]),
      reading('r2', [says('EDGE-R3', 'GigabitEthernet0/1', 'GigabitEthernet0/0')]),
    ], id);
    expect(got).toMatchObject({ added: 0, unsure: 2 });
  });

  it('unless both ends report one of them, which is then the cable', () => {
    const got = fillDrawnLinks([R1, R2, R3], [], [
      reading('r1', [says('EDGE-R3', 'GigabitEthernet0/1', 'GigabitEthernet0/0')]),
      reading('r2', [says('EDGE-R3', 'GigabitEthernet0/1', 'GigabitEthernet0/0')]),
      reading('r3', [says('EDGE-R1', 'GigabitEthernet0/0', 'GigabitEthernet0/1')]),
    ], id);
    expect(got).toMatchObject({ added: 1, unsure: 1 });
    expect(got.edges[0]).toMatchObject({ source: 'r1', target: 'r3' });
    expect((got.edges[0]!.data as LinkData).drawnSaid?.both).toBe(true);
  });

  it('a full mesh of routers is every cable once, each on its own ports', () => {
    const got = fillDrawnLinks([R1, R2, R3], [], [
      reading('r1', [says('EDGE-R2', 'GigabitEthernet0/1', 'GigabitEthernet0/1'), says('EDGE-R3', 'GigabitEthernet0/2', 'GigabitEthernet0/1')]),
      reading('r2', [says('EDGE-R1', 'GigabitEthernet0/1', 'GigabitEthernet0/1'), says('EDGE-R3', 'GigabitEthernet0/2', 'GigabitEthernet0/2')]),
      reading('r3', [says('EDGE-R1', 'GigabitEthernet0/1', 'GigabitEthernet0/2'), says('EDGE-R2', 'GigabitEthernet0/2', 'GigabitEthernet0/2')]),
    ], id);
    expect(got).toMatchObject({ added: 3, unsure: 0 });
    expect(got.edges.every((e) => (e.data as LinkData).drawnSaid?.both)).toBe(true);
  });

  it('a link drawn between two peers with no cable between them is kept as a logical link', () => {
    const got = fillDrawnLinks([R1, R2, R3], [link('bgp', 'r1', 'r3')], [
      reading('r1', [says('EDGE-R2', 'GigabitEthernet0/1', 'GigabitEthernet0/1')]),
      reading('r3', [says('EDGE-R2', 'GigabitEthernet0/1', 'GigabitEthernet0/2')]),
    ], id);
    expect(dataOf(got.edges, 'bgp').drawnCheck).toBe('unmet');
    expect(got.edges.some((e) => e.id === 'bgp')).toBe(true);
  });
});
