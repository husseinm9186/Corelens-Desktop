/**
 * A diagram somebody drew, checked against the devices on it.
 *
 * The devices drawn on a page are each asked who is on their ports — and
 * nobody else is. What they say is matched to what is drawn:
 *
 * - a drawn link the devices confirm takes its port at each end, and what
 *   the port is made of (copper, an SFP, a QSFP);
 * - a drawn link no device reports is never removed: it is kept as a
 *   logical link (purple, dotted), where at least one of its ends was
 *   asked — a link neither end could be asked about is left exactly as it
 *   was, because nothing is known about it; one drawn as a logical link on
 *   purpose is not checked;
 * - a cable the devices report between two drawn devices that nobody drew
 *   is drawn, its ports filled in; through a management port, as a
 *   management link;
 * - where CDP and LLDP say nothing — a firewall speaks neither — a cable is
 *   told by MAC address: a switch port that learned the address of one of
 *   another drawn device's interfaces, and of no other drawn device, and
 *   few addresses at all, is that device's cable (see `macCables`);
 * - nothing else is added. A neighbour that is not on the page is not put
 *   on it.
 *
 * Pure, so every rule here is tested without a device.
 */
import { identity, serialsDisagree, shortInterface } from './topology';
import { parseSerials } from './serials';
import type { Neighbor } from './ipc';
import type { TopoEdge, TopoNode } from '../state/store';
import { linkMarkColours, readableOn, type Ground } from '../theme';
import type { DeviceNodeData, LinkData, LinkMedia } from '../types/domain';

/** What one drawn device said. */
export interface DeviceReading {
  nodeId: string;
  neighbors: Neighbor[];
  /** What each of its ports is made of, as the device words it. */
  ports: { port: string; media: string; speed: string }[];
  /** Its MAC address table, where it keeps one. */
  macs?: { mac: string; port: string }[];
  /** Its ARP table. */
  arp?: { ip: string; mac: string }[];
  /** Its own interfaces' MAC addresses. */
  own?: { port: string; mac: string }[];
}

export interface DrawnLinksResult {
  edges: TopoEdge[];
  /** Drawn links confirmed, their ports filled in. */
  met: number;
  /** Drawn links no device reports. */
  unmet: number;
  /** Drawn links neither of whose ends was asked. */
  unasked: number;
  /** Management links: drawn ones recognised, and ones added. */
  management: number;
  added: number;
  /** Cables the devices report between two drawn devices that are not drawn. */
  undrawn: number;
  /** Neighbours the devices report that are not on the page. */
  strangers: number;
  /** Cables told by MAC address, drawn or filled in. */
  byMac: number;
}

/** More addresses than this learned on one port, and the port is taken to
 *  lead to another switch rather than to one device: a firewall's or a
 *  router's port shows its own address and perhaps a peer's or a virtual
 *  one, not a crowd. */
export const MAC_PORT_LIMIT = 8;

/**
 * Whether a port is a device's management port rather than one of its
 * data ports: `mgmt0`, `Management1`, `fxp0`, `me0`, `oob`; and on a switch
 * `Gi0/0` or `Fa0`, the out-of-band port of the chassis. On a router those
 * two are ordinary ports, which is why the device is asked about.
 */
export function isManagementPort(port: string, onSwitch: boolean): boolean {
  const p = port.trim().toLowerCase().replace(/\s+/g, '');
  if (!p) return false;
  if (/^(mgmt|mgmteth|management|ma|oob|fxp|vme|me|em)\d+([/.:]\d+)*$/.test(p) || p === 'oob' || p === 'mgmt') return true;
  return onSwitch && /^(gi|gigabitethernet|gig)0\/0$|^(fa|fastethernet)0$/.test(p);
}

/**
 * What a port is made of, from what the device calls the thing in it and,
 * failing that, from what the port is called. `null` where neither says —
 * a Nexus names every port `Ethernet`, whatever is plugged into it.
 */
export function mediaOf(media: string | undefined, port: string): LinkMedia | null {
  const m = (media ?? '').trim().toLowerCase();
  if (m && !/^(-+|unknown|notpresent|not present|no transceiver|absent)$/.test(m)) {
    if (/qsfp|cfp|\b(40|100|200|400)g/.test(m)) return 'qsfp';
    if (/base-?tx?\b|10\/100|rj-?45|copper/.test(m) && !/sfp/.test(m)) return 'ethernet';
    if (/sfp|xfp|gbic|\d+g?base|twinax|fiber|fibre/.test(m)) return 'sfp';
  }
  const p = shortInterface(port).toLowerCase();
  if (/^(fo|hu|fourhundredgige|twohundredgige|fh|th|qsfp|et-)/.test(p)) return 'qsfp';
  if (/^(te|twe|fif|fi\d|xe|xge|sfp)/.test(p)) return 'sfp';
  if (/^(gi|fa|ge-|mgmt|management|ma\d|fxp|me\d)/.test(p)) return 'ethernet';
  return null;
}

const bare = (address: string) => address.trim().split('/')[0]!.trim();
const isSwitch = (d: DeviceNodeData) => /switch/i.test(String(d.deviceType ?? ''));

interface Found {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  /** Told by MAC address rather than by a neighbour protocol. */
  via?: 'mac';
  /** What `a` called `b`'s port where that is not one of `b`'s ports: a
   *  description of it. Shown only where nothing names the port. */
  bHint?: string;
}

/** An interface that is not a socket a cable goes into. */
const isLogicalInterface = (port: string) => /^(vl|vlan|bvi|bdi|irb|lo|loopback|tu|tunnel|nve|vti|null|dialer|virtual-)[\s-]?\d/i.test(port.trim());

export function fillDrawnLinks(
  nodes: readonly TopoNode[],
  edges: readonly TopoEdge[],
  allReadings: readonly DeviceReading[],
  newId: () => string,
): DrawnLinksResult {
  const devices = nodes.filter((n) => n.type === 'device');
  const dataOf = new Map(devices.map((n) => [n.id, n.data as DeviceNodeData]));

  // Who a reported neighbour is, among the devices drawn: by serial, then
  // by name, then by the address it is managed on — strongest first, and a
  // serial that names another chassis overrules the rest.
  const bySerial = new Map<string, string>();
  const byName = new Map<string, string>();
  const byAddress = new Map<string, string>();
  const twinOf = new Map<string, string>();
  for (const n of devices) {
    const d = n.data as DeviceNodeData;
    for (const s of parseSerials(d.serial ?? '')) if (!bySerial.has(s.toUpperCase())) bySerial.set(s.toUpperCase(), n.id);
    for (const name of [d.hostname, d.label]) {
      const key = identity(name ?? '', '');
      if (key.startsWith('n:') && !byName.has(key)) byName.set(key, n.id);
    }
    const primary = bare(d.addresses?.find((a) => a.isPrimary)?.address ?? d.addresses?.[0]?.address ?? '');
    if (primary && !byAddress.has(primary)) byAddress.set(primary, n.id);
    // One device drawn twice is one device: the first drawing stands for
    // both wherever cables are counted.
    if (primary) twinOf.set(n.id, byAddress.get(primary)!);
  }
  const one = (id: string) => twinOf.get(id) ?? id;
  const readings: DeviceReading[] = [];
  for (const r of allReadings) {
    const nodeId = one(r.nodeId);
    if (!readings.some((x) => x.nodeId === nodeId)) readings.push(nodeId === r.nodeId ? r : { ...r, nodeId });
  }
  const asked = new Set(readings.map((r) => r.nodeId));
  const drawnAs = (n: Neighbor): string | undefined => {
    const id = drawnAsAny(n);
    return id === undefined ? undefined : one(id);
  };
  const drawnAsAny = (n: Neighbor): string | undefined => {
    const serial = n.serial?.trim().toUpperCase();
    if (serial && bySerial.has(serial)) return bySerial.get(serial);
    const agrees = (id: string | undefined) => (id && !serialsDisagree(dataOf.get(id)?.serial, n.serial) ? id : undefined);
    const named = agrees(byName.get(identity(n.shortName || n.deviceId, '')));
    if (named) return named;
    for (const a of n.addresses ?? []) {
      const at = agrees(byAddress.get(bare(a.ip)));
      if (at) return at;
    }
    return undefined;
  };

  // The cables the devices report between two drawn devices, each once
  // however many of its ends reported it.
  // The ports each device that was asked names as its own. LLDP sends a
  // port's description where it has one, so what one end calls the other's
  // port is a name only where the other end has a port called that.
  const ownPorts = new Map<string, Set<string>>();
  for (const r of readings) {
    const ports = new Set<string>();
    for (const n of r.neighbors) if (n.localInterface) ports.add(shortInterface(n.localInterface));
    for (const p of r.ports) ports.add(shortInterface(p.port));
    for (const o of r.own ?? []) ports.add(shortInterface(o.port));
    for (const m of r.macs ?? []) ports.add(shortInterface(m.port));
    ownPorts.set(r.nodeId, ports);
  }
  const isPortOf = (nodeId: string, port: string) => {
    const ports = ownPorts.get(nodeId);
    return !ports || ports.size === 0 || ports.has(port);
  };

  const found: Found[] = [];
  let strangers = 0;
  for (const r of readings) {
    for (const n of r.neighbors) {
      const other = drawnAs(n);
      if (!other) {
        strangers += 1;
        continue;
      }
      if (other === r.nodeId) continue;
      const here = shortInterface(n.localInterface ?? '');
      const said = shortInterface(n.remoteInterface ?? '');
      const there = isPortOf(other, said) ? said : '';
      const hint = there ? '' : said;
      const same = found.find(
        (f) =>
          (f.a === r.nodeId && f.b === other && f.aPort === here && (!f.bPort || !there || f.bPort === there)) ||
          (f.b === r.nodeId && f.a === other && (!f.bPort || f.bPort === here) && (!there || !f.aPort || f.aPort === there) && (Boolean(f.bPort) || Boolean(there))),
      );
      if (!same) {
        found.push({ a: r.nodeId, aPort: here, b: other, bPort: there, ...(hint ? { bHint: hint } : {}) });
        continue;
      }
      // The other end's own word for its port fills a blank.
      if (same.a === r.nodeId) {
        same.bPort ||= there;
        if (hint) same.bHint ||= hint;
      } else {
        same.bPort ||= here;
        same.aPort ||= there;
      }
    }
  }
  // Each end reporting a cable without naming the other's port: one report
  // from each end is one cable, each end's port its own. More than one
  // from each is that many cables, and which far port is whose is not known.
  for (const f of [...found]) {
    if (!found.includes(f) || f.bPort) continue;
    const mine = found.filter((x) => x.a === f.a && x.b === f.b && !x.bPort);
    const theirs = found.filter((x) => x.a === f.b && x.b === f.a && !x.bPort);
    if (theirs.length === 0) continue;
    if (mine.length === 1 && theirs.length === 1) {
      f.bPort = theirs[0]!.aPort;
      found.splice(found.indexOf(theirs[0]!), 1);
      continue;
    }
    // The same cables, counted from both ends: the fewer are among the more.
    const spare = mine.length >= theirs.length ? theirs : mine;
    for (const x of spare) found.splice(found.indexOf(x), 1);
  }
  // Where nothing named the far port, what was said of it is all there is.
  for (const f of found) if (!f.bPort && f.bHint) f.bPort = f.bHint;

  const byMac = macCables(readings, found, byAddress, dataOf);
  found.push(...byMac);

  const portMedia = new Map<string, string>();
  for (const r of readings) for (const p of r.ports) portMedia.set(`${r.nodeId}/${shortInterface(p.port)}`, p.media);
  const rank: Record<LinkMedia, number> = { ethernet: 1, sfp: 2, qsfp: 3 };
  const mediaFor = (f: Found): LinkMedia | undefined => {
    const ends = [mediaOf(portMedia.get(`${f.a}/${f.aPort}`), f.aPort), mediaOf(portMedia.get(`${f.b}/${f.bPort}`), f.bPort)].filter((m): m is LinkMedia => m !== null);
    // Where the two ends are worded differently, the more particular wins.
    return ends.sort((x, y) => rank[y] - rank[x])[0];
  };
  const management = (f: Found) =>
    isManagementPort(f.aPort, isSwitch(dataOf.get(f.a) ?? ({} as DeviceNodeData))) ||
    isManagementPort(f.bPort, isSwitch(dataOf.get(f.b) ?? ({} as DeviceNodeData)));

  const pairKey = (x: string, y: string) => [x, y].sort().join('::');
  const foundByPair = new Map<string, Found[]>();
  for (const f of found) foundByPair.set(pairKey(f.a, f.b), [...(foundByPair.get(pairKey(f.a, f.b)) ?? []), f]);

  // Only cables are checked: a note's leader, a tunnel and a routed hop are
  // not things a neighbour table reports.
  const checkable = (e: TopoEdge) => {
    const d = (e.data ?? {}) as LinkData;
    // One drawn as a logical link or a tunnel on purpose is not a cable.
    if (d.linkKind === 'logical' || d.linkKind === 'tunnel') return false;
    return dataOf.has(e.source) && dataOf.has(e.target) && one(e.source) !== one(e.target) && d.kind !== 'leader' && !d.overlay && !d.layer3;
  };
  const drawnByPair = new Map<string, TopoEdge[]>();
  for (const e of edges) {
    if (!checkable(e)) continue;
    const key = pairKey(one(e.source), one(e.target));
    drawnByPair.set(key, [...(drawnByPair.get(key) ?? []), e]);
  }

  const patches = new Map<string, Partial<LinkData>>();
  const addedEdges: TopoEdge[] = [];
  const result = { met: 0, unmet: 0, unasked: 0, management: 0, added: 0, undrawn: 0, strangers, byMac: byMac.length };

  /** The found cable's ports, the way round this drawn link runs. */
  const portsAlong = (e: TopoEdge, f: Found) => (one(e.source) === f.a ? [f.aPort, f.bPort] : [f.bPort, f.aPort]) as [string, string];
  const confirm = (e: TopoEdge, f: Found) => {
    const [sourcePort, targetPort] = portsAlong(e, f);
    const had = (e.data ?? {}) as LinkData;
    const media = mediaFor(f);
    const mgmt = management(f);
    // A port the devices did not name keeps whatever was typed; and one
    // told by MAC address is an inference, so what was typed wins over it.
    const port = (told: string, typed: string | undefined) => (f.via === 'mac' ? typed || told : told || typed) || '';
    patches.set(e.id, {
      sourcePortLabel: port(sourcePort, had.sourcePortLabel),
      targetPortLabel: port(targetPort, had.targetPortLabel),
      drawnCheck: 'met',
      drawnVia: f.via,
      ...(media ? { media } : {}),
      ...(mgmt ? { linkKind: 'management' as const } : {}),
    });
    if (mgmt) result.management += 1;
    result.met += 1;
  };

  for (const pair of new Set([...drawnByPair.keys(), ...foundByPair.keys()])) {
    const drawn = [...(drawnByPair.get(pair) ?? [])];
    const reported = [...(foundByPair.get(pair) ?? [])];
    const take = (e: TopoEdge, f: Found) => {
      drawn.splice(drawn.indexOf(e), 1);
      reported.splice(reported.indexOf(f), 1);
      confirm(e, f);
    };
    const labels = (e: TopoEdge) => {
      const d = (e.data ?? {}) as LinkData;
      return [shortInterface(d.sourcePortLabel ?? ''), shortInterface(d.targetPortLabel ?? '')] as [string, string];
    };
    // A drawn link that already names its ports is the cable on those
    // ports: both ends first, then one.
    for (const need of [2, 1]) {
      for (const e of [...drawn]) {
        const [s, t] = labels(e);
        const f = reported.find((x) => {
          const [fs, ft] = portsAlong(e, x);
          const hits = Number(Boolean(s) && s === fs) + Number(Boolean(t) && t === ft);
          const clashes = (Boolean(s) && Boolean(fs) && s !== fs) || (Boolean(t) && Boolean(ft) && t !== ft);
          return hits >= need && !clashes;
        });
        if (f) take(e, f);
      }
    }
    // The rest in the order drawn: unlabelled links first, and cables
    // before management ports, so a link drawn between two switches is the
    // cable between them rather than their management ports.
    const blank = (e: TopoEdge) => labels(e).every((l) => !l);
    for (const e of [...drawn].sort((x, y) => Number(blank(y)) - Number(blank(x)))) {
      const f = reported.find((x) => !management(x)) ?? reported[0];
      if (!f) break;
      take(e, f);
    }
    // Drawn, and no device reports it.
    for (const e of drawn) {
      if (asked.has(one(e.source)) || asked.has(one(e.target))) {
        patches.set(e.id, { drawnCheck: 'unmet' });
        result.unmet += 1;
      } else {
        result.unasked += 1;
      }
    }
    // Reported, and not drawn: drawn now, as a management link where it
    // is on a management port.
    for (const f of reported) {
      const mgmt = management(f);
      const media = mediaFor(f);
      addedEdges.push({
        id: newId(),
        source: f.a,
        target: f.b,
        sourceHandle: 'b',
        targetHandle: 't',
        type: 'live',
        data: {
          sourcePortLabel: f.aPort,
          targetPortLabel: f.bPort,
          label: '',
          // A cable has no direction; without this it is drawn with an arrow.
          direction: 'none',
          enabled: true,
          maintenance: false,
          healthRule: { type: 'both-endpoints' },
          ...(mgmt ? { linkKind: 'management' as const } : {}),
          drawnCheck: 'met',
          ...(f.via ? { drawnVia: f.via } : {}),
          ...(media ? { media } : {}),
        } as LinkData,
      } as TopoEdge);
      if (mgmt) result.management += 1;
      result.added += 1;
    }
  }

  // A link since chosen as logical or a tunnel is no longer a finding.
  for (const e of edges) {
    const d = (e.data ?? {}) as LinkData;
    if (d.drawnCheck === 'unmet' && (d.linkKind === 'logical' || d.linkKind === 'tunnel')) patches.set(e.id, { drawnCheck: undefined });
  }

  const next = edges.map((e) => {
    const patch = patches.get(e.id);
    return patch ? ({ ...e, data: { ...e.data, ...patch } } as TopoEdge) : e;
  });
  return { edges: patches.size || addedEdges.length ? [...next, ...addedEdges] : (edges as TopoEdge[]), ...result };
}

/**
 * Cables told by MAC address, for the ports no neighbour protocol named.
 *
 * Whose an address is: a drawn device's own interface listing, or, for a
 * device that could not be asked, the ARP entry of the address it is drawn
 * with. An address two drawn devices claim is nobody's. Then, for each
 * switch that gave its MAC table, each port that learned the addresses of
 * exactly one other drawn device, and few addresses at all, is a cable to
 * it — on that device's interface whose address it is, where exactly one
 * of its interfaces has it, and blank otherwise. A port a neighbour
 * protocol already reported is left to it, and so is a pair of devices it
 * already found a cable between.
 */
function macCables(
  readings: readonly DeviceReading[],
  known: readonly Found[],
  byAddress: ReadonlyMap<string, string>,
  dataOf: ReadonlyMap<string, DeviceNodeData>,
): Found[] {
  // address → its device, and the interfaces of it that have it.
  const owner = new Map<string, { nodeId: string; ports: Set<string> } | null>();
  const claim = (mac: string, nodeId: string, port: string | null) => {
    const m = mac.toLowerCase();
    const had = owner.get(m);
    if (had === null) return;
    if (had && had.nodeId !== nodeId) {
      owner.set(m, null);
      return;
    }
    const entry = had ?? { nodeId, ports: new Set<string>() };
    // A VLAN interface or a loopback has the address and no socket.
    if (port && !isLogicalInterface(port)) entry.ports.add(shortInterface(port));
    owner.set(m, entry);
  };
  const ownRead = new Set<string>();
  for (const r of readings) {
    for (const o of r.own ?? []) {
      claim(o.mac, r.nodeId, o.port);
      ownRead.add(r.nodeId);
    }
  }
  for (const r of readings) {
    for (const a of r.arp ?? []) {
      const nodeId = byAddress.get(bare(a.ip));
      // Only for a device whose own listing was not read: its own word wins.
      if (nodeId && nodeId !== r.nodeId && !ownRead.has(nodeId)) claim(a.mac, nodeId, null);
    }
  }

  const pairKey = (x: string, y: string) => [x, y].sort().join('::');
  const pairs = new Set(known.map((f) => pairKey(f.a, f.b)));
  // Every port that qualifies, before any is believed.
  const seen: { switchId: string; port: string; other: string; bPort: string; macs: string[]; learned: number }[] = [];
  for (const r of readings) {
    if (!r.macs?.length || !dataOf.has(r.nodeId)) continue;
    const named = new Set(r.neighbors.map((n) => shortInterface(n.localInterface ?? '')).filter(Boolean));
    for (const f of known) {
      if (f.a === r.nodeId && f.aPort) named.add(f.aPort);
      if (f.b === r.nodeId && f.bPort) named.add(f.bPort);
    }
    const onPort = new Map<string, Set<string>>();
    for (const e of r.macs) {
      const port = shortInterface(e.port);
      if (!port) continue;
      onPort.set(port, (onPort.get(port) ?? new Set()).add(e.mac.toLowerCase()));
    }
    for (const [port, macs] of onPort) {
      if (named.has(port) || macs.size > MAC_PORT_LIMIT) continue;
      const devices = new Map<string, Set<string>>();
      for (const mac of macs) {
        const o = owner.get(mac);
        if (!o || o.nodeId === r.nodeId) continue;
        const ports = devices.get(o.nodeId) ?? new Set<string>();
        for (const p of o.ports) ports.add(p);
        // One address on two of its interfaces says nothing about which.
        if (o.ports.size > 1) ports.add('\u0000ambiguous');
        devices.set(o.nodeId, ports);
      }
      if (devices.size !== 1) continue;
      const [other, ports] = [...devices][0]!;
      if (pairs.has(pairKey(r.nodeId, other))) continue;
      const theirs = [...ports];
      const bPort = theirs.length === 1 && !theirs[0]!.startsWith('\u0000') ? theirs[0]! : '';
      seen.push({ switchId: r.nodeId, port, other, bPort, macs: [...macs].filter((m) => owner.get(m)?.nodeId === other), learned: macs.size });
    }
  }
  // One address is on one cable. A second switch learns it too, on the port
  // towards the first; that port learned everything else behind it as well,
  // so of the switches that learned an address, the one whose port learned
  // fewest is where it is plugged in. Several may have learned as few as
  // each other: that is a bundle to a pair of switches where the device has
  // that many interfaces with the address, and otherwise nothing says
  // which, and none is believed.
  const dropped = new Set<(typeof seen)[number]>();
  for (const mac of new Set(seen.flatMap((c) => c.macs))) {
    const holders = seen.filter((c) => c.macs.includes(mac));
    if (new Set(holders.map((c) => c.switchId)).size < 2) continue;
    const fewest = Math.min(...holders.map((c) => c.learned));
    const nearest = new Set(holders.filter((c) => c.learned === fewest).map((c) => c.switchId));
    const sockets = Math.max(1, owner.get(mac)?.ports.size ?? 0);
    for (const c of holders) if (nearest.size > sockets || !nearest.has(c.switchId)) dropped.add(c);
  }
  const out: Found[] = [];
  for (const c of seen) {
    if (dropped.has(c)) continue;
    // The same cable seen from the other switch's table fills its blank.
    const same = out.find((x) => x.a === c.other && x.b === c.switchId);
    if (same) {
      same.bPort ||= c.port;
      continue;
    }
    out.push({ a: c.switchId, aPort: c.port, b: c.other, bPort: c.bPort, via: 'mac' });
  }
  return out;
}

/** The marks this leaves on a link, taken off again. The ports it filled in
 *  stay: they are what the devices said. */
export function clearDrawnMarks(edges: readonly TopoEdge[]): { edges: TopoEdge[]; cleared: number } {
  let cleared = 0;
  const next = edges.map((e) => {
    const d = (e.data ?? {}) as LinkData;
    if (d.drawnCheck === undefined && d.media === undefined && d.drawnVia === undefined) return e;
    cleared += 1;
    const rest = { ...d };
    delete rest.drawnCheck;
    delete rest.media;
    delete rest.drawnVia;
    return { ...e, data: rest } as TopoEdge;
  });
  return { edges: cleared ? next : (edges as TopoEdge[]), cleared };
}

/** What the legend needs to say about the links on a page: which of the
 *  marks are in use, and on how many links. */
export function drawnLegend(edges: readonly TopoEdge[]): { key: LinkMedia | 'management' | 'unmet'; count: number }[] {
  const count = { ethernet: 0, sfp: 0, qsfp: 0, management: 0, unmet: 0 };
  for (const e of edges) {
    const mark = drawnMark((e.data ?? {}) as LinkData);
    if (mark) count[mark] += 1;
  }
  return (['ethernet', 'sfp', 'qsfp', 'management', 'unmet'] as const).filter((k) => count[k] > 0).map((key) => ({ key, count: count[key] }));
}

/** The one mark a link is coloured by: not found beats everything, a
 *  management link is a management link whatever its port is made of. */
export function drawnMark(d: Partial<Pick<LinkData, 'drawnCheck' | 'media' | 'linkKind'>>): LinkMedia | 'management' | 'unmet' | null {
  // Chosen as a logical link or a tunnel, it is what it was drawn to be.
  if (d.drawnCheck === 'unmet' && d.linkKind !== 'logical' && d.linkKind !== 'tunnel') return 'unmet';
  if (d.linkKind === 'management') return 'management';
  return d.drawnCheck === 'met' && d.media ? d.media : null;
}

/**
 * The colour a link's line is drawn in, where something other than its
 * health decides: purple for a drawn link no device reports — whatever
 * colour it was given, because it is a finding — then a colour somebody
 * chose for it, then sky blue for a management link or the colour of what
 * its ports are made of. `null` leaves it to the link's health.
 */
export function lineColourOf(d: Partial<Pick<LinkData, 'drawnCheck' | 'media' | 'linkKind' | 'colorMode' | 'color'>>, ground: Ground): string | null {
  const mark = drawnMark(d);
  if (mark === 'unmet') return linkMarkColours(ground).unmet;
  if (d.colorMode === 'fixed' && d.color) return readableOn(d.color, ground);
  return mark ? linkMarkColours(ground)[mark] : null;
}

/** A page's links without its management links, where they are hidden.
 *  The same list back when there is nothing to leave out. */
export function withoutHiddenManagement<T extends { data?: unknown }>(edges: T[], hide: boolean | undefined): T[] {
  if (!hide || !edges.some((e) => (e.data as LinkData | undefined)?.linkKind === 'management')) return edges;
  return edges.filter((e) => (e.data as LinkData | undefined)?.linkKind !== 'management');
}
