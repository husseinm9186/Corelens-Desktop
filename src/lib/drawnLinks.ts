/**
 * A diagram somebody drew, checked against the devices on it.
 *
 * The devices drawn on a page are each asked who is on their ports — and
 * nobody else is. What they say is matched to what is drawn:
 *
 * - a drawn link the devices confirm takes its port at each end, and what
 *   the port is made of (copper, an SFP, a QSFP);
 * - a drawn link no device reports is marked as not found, where at least
 *   one of its ends was asked — a link neither end could be asked about is
 *   left exactly as it was, because nothing is known about it;
 * - a link the devices report through a management port is drawn as a
 *   management link, whether or not it was drawn before;
 * - nothing else is added. A neighbour that is not on the page is not put
 *   on it, and a cable between two drawn devices that nobody drew is
 *   counted and left undrawn.
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
}

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
}

export function fillDrawnLinks(
  nodes: readonly TopoNode[],
  edges: readonly TopoEdge[],
  readings: readonly DeviceReading[],
  newId: () => string,
): DrawnLinksResult {
  const devices = nodes.filter((n) => n.type === 'device');
  const dataOf = new Map(devices.map((n) => [n.id, n.data as DeviceNodeData]));
  const asked = new Set(readings.map((r) => r.nodeId));

  // Who a reported neighbour is, among the devices drawn: by serial, then
  // by name, then by the address it is managed on — strongest first, and a
  // serial that names another chassis overrules the rest.
  const bySerial = new Map<string, string>();
  const byName = new Map<string, string>();
  const byAddress = new Map<string, string>();
  for (const n of devices) {
    const d = n.data as DeviceNodeData;
    for (const s of parseSerials(d.serial ?? '')) if (!bySerial.has(s.toUpperCase())) bySerial.set(s.toUpperCase(), n.id);
    for (const name of [d.hostname, d.label]) {
      const key = identity(name ?? '', '');
      if (key.startsWith('n:') && !byName.has(key)) byName.set(key, n.id);
    }
    const primary = bare(d.addresses?.find((a) => a.isPrimary)?.address ?? d.addresses?.[0]?.address ?? '');
    if (primary && !byAddress.has(primary)) byAddress.set(primary, n.id);
  }
  const drawnAs = (n: Neighbor): string | undefined => {
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
      const there = shortInterface(n.remoteInterface ?? '');
      const same = found.find(
        (f) =>
          (f.a === r.nodeId && f.b === other && f.aPort === here && (!f.bPort || !there || f.bPort === there)) ||
          (f.b === r.nodeId && f.a === other && (!f.bPort || f.bPort === here) && (!there || !f.aPort || f.aPort === there) && (Boolean(f.bPort) || Boolean(there))),
      );
      if (!same) {
        found.push({ a: r.nodeId, aPort: here, b: other, bPort: there });
        continue;
      }
      // The other end's own word for its port fills a blank.
      if (same.a === r.nodeId) same.bPort ||= there;
      else {
        same.bPort ||= here;
        same.aPort ||= there;
      }
    }
  }

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
    return dataOf.has(e.source) && dataOf.has(e.target) && e.source !== e.target && d.kind !== 'leader' && !d.overlay && !d.layer3;
  };
  const drawnByPair = new Map<string, TopoEdge[]>();
  for (const e of edges) if (checkable(e)) drawnByPair.set(pairKey(e.source, e.target), [...(drawnByPair.get(pairKey(e.source, e.target)) ?? []), e]);

  const patches = new Map<string, Partial<LinkData>>();
  const addedEdges: TopoEdge[] = [];
  const result = { met: 0, unmet: 0, unasked: 0, management: 0, added: 0, undrawn: 0, strangers };

  /** The found cable's ports, the way round this drawn link runs. */
  const portsAlong = (e: TopoEdge, f: Found) => (e.source === f.a ? [f.aPort, f.bPort] : [f.bPort, f.aPort]) as [string, string];
  const confirm = (e: TopoEdge, f: Found) => {
    const [sourcePort, targetPort] = portsAlong(e, f);
    const had = (e.data ?? {}) as LinkData;
    const media = mediaFor(f);
    const mgmt = management(f);
    patches.set(e.id, {
      // A port the devices did not name keeps whatever was typed.
      sourcePortLabel: sourcePort || had.sourcePortLabel || '',
      targetPortLabel: targetPort || had.targetPortLabel || '',
      drawnCheck: 'met',
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
      if (asked.has(e.source) || asked.has(e.target)) {
        patches.set(e.id, { drawnCheck: 'unmet' });
        result.unmet += 1;
      } else {
        result.unasked += 1;
      }
    }
    // Reported, and not drawn: a management link is drawn; a cable is not.
    for (const f of reported) {
      if (!management(f)) {
        result.undrawn += 1;
        continue;
      }
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
          linkKind: 'management',
          drawnCheck: 'met',
          ...(media ? { media } : {}),
        } as LinkData,
      } as TopoEdge);
      result.management += 1;
      result.added += 1;
    }
  }

  const next = edges.map((e) => {
    const patch = patches.get(e.id);
    return patch ? ({ ...e, data: { ...e.data, ...patch } } as TopoEdge) : e;
  });
  return { edges: patches.size || addedEdges.length ? [...next, ...addedEdges] : (edges as TopoEdge[]), ...result };
}

/** The marks this leaves on a link, taken off again. The ports it filled in
 *  stay: they are what the devices said. */
export function clearDrawnMarks(edges: readonly TopoEdge[]): { edges: TopoEdge[]; cleared: number } {
  let cleared = 0;
  const next = edges.map((e) => {
    const d = (e.data ?? {}) as LinkData;
    if (d.drawnCheck === undefined && d.media === undefined) return e;
    cleared += 1;
    const rest = { ...d };
    delete rest.drawnCheck;
    delete rest.media;
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
  if (d.drawnCheck === 'unmet') return 'unmet';
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
