/**
 * The project's tables as CSV: every port a crawl read, every VLAN
 * each device has, and what every probe last found.
 *
 * Devices, links and the cable schedule already had their own files; these
 * are the rest of what an engineer is asked for in a spreadsheet. Every page
 * is included, because a table is an inventory, not a drawing.
 *
 * `asBuiltCsv` is the device table of an as-built document: one row per
 * device with what it is, where it is, how it is addressed and what it is
 * cabled to.
 */
import { toCsv } from './csv';
import { buildIpam, ipamRows } from './ipam';
import { availability, type Sample } from './sparkline';
import type { ProjectDocument } from '../state/store';
import { SHAPE_DEVICE_TYPES, type DeviceNodeData, type LinkData, type Probe, type ProbeRuntime } from '../types/domain';
import { allEdges, allNodes } from './pages';

const devicesOf = (doc: ProjectDocument) =>
  allNodes(doc)
    .filter((n) => n.type === 'device')
    .map((n) => ({ id: n.id, d: n.data as DeviceNodeData, page: doc.pages.find((p) => p.nodes.some((x) => x.id === n.id))?.name ?? '' }));

/** The address register, a row per known address. */
export function ipamCsv(doc: ProjectDocument): string {
  return toCsv(ipamRows(buildIpam(allNodes(doc), doc.ipam), doc.ipam?.customFields));
}

export function portsCsv(doc: ProjectDocument): string {
  const rows: unknown[][] = [];
  for (const { d, page } of devicesOf(doc)) {
    for (const p of d.inventory?.ports ?? []) {
      const e = p.errors;
      rows.push([
        d.label, page, p.port, p.description ?? '', p.status, p.speed ?? '', p.duplex ?? '', p.mode ?? '',
        p.vlan ?? '', p.trunkVlans ?? '', e?.input ?? '', e?.crc ?? '', e?.output ?? '', e?.collisions ?? '', e?.drops ?? '', e?.resets ?? '',
      ]);
    }
  }
  return toCsv([
    ['Device', 'Page', 'Port', 'Description', 'Status', 'Speed', 'Duplex', 'Mode', 'VLAN', 'Trunk VLANs', 'Input errors', 'CRC', 'Output errors', 'Collisions', 'Drops', 'Resets'],
    ...rows,
  ]);
}

/** One row per VLAN per device, with how many of the device's ports carry it
 *  untagged. */
export function vlansCsv(doc: ProjectDocument): string {
  const rows: unknown[][] = [];
  for (const { d, page } of devicesOf(doc)) {
    for (const v of d.inventory?.vlans ?? []) {
      const access = (d.inventory?.ports ?? []).filter((p) => p.mode !== 'trunk' && p.vlan === v.id).length;
      rows.push([v.id, v.name, d.label, page, access]);
    }
  }
  rows.sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[2]).localeCompare(String(b[2])));
  return toCsv([['VLAN', 'Name', 'Device', 'Page', 'Access ports'], ...rows]);
}

export function probeResultsCsv(
  doc: ProjectDocument,
  runtime: ReadonlyMap<string, ProbeRuntime>,
  samples: ReadonlyMap<string, readonly Sample[]>,
): string {
  const names = new Map(devicesOf(doc).map(({ id, d }) => [id, d.label]));
  const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : '');
  const target = (p: Probe) => (p.kind === 'tcp' && p.tcpPort ? `${p.target}:${p.tcpPort}` : p.target);
  return toCsv([
    ['Object', 'Probe', 'Kind', 'Target', 'Enabled', 'Status', 'Last RTT (ms)', 'Last success', 'Last failure', 'Failures in a row', 'Availability (%)', 'Samples', 'Last result'],
    ...doc.probes.map((p) => {
      const r = runtime.get(p.id);
      const s = samples.get(p.id) ?? [];
      return [
        names.get(p.objectId) ?? (p.objectKind === 'link' ? 'Link' : ''), p.name, p.kind, target(p), p.enabled ? 'yes' : 'no',
        r?.status ?? 'unknown', r?.lastRttMs ?? '', iso(r?.lastSuccessMs), iso(r?.lastFailureMs), r?.consecutiveFailures ?? '',
        availability(s) ?? '', s.length, r?.lastSummary ?? '',
      ];
    }),
  ]);
}

/** A crawl's VLAN ids as ranges: `1,10,14-16`. */
function vlanRanges(ids: number[]): string {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(',');
}

/**
 * The device table an as-built document wants: one row per device, in site
 * then name order. Drawn shapes — boxes, zones, text — are not devices and
 * are left out. A cell that holds several things separates them with
 * semicolons, as the other device files do.
 */
export function asBuiltCsv(doc: ProjectDocument): string {
  const devices = devicesOf(doc).filter(({ d }) => !SHAPE_DEVICE_TYPES.has(d.deviceType));
  const names = new Map(devices.map(({ id, d }) => [id, d.label]));
  // Each device's cables, told from its own end.
  const cabled = new Map<string, string[]>();
  for (const e of allEdges(doc)) {
    const l = (e.data ?? {}) as Partial<LinkData>;
    if (l.kind === 'leader') continue;
    const ends = [
      [e.source, l.sourcePortLabel, e.target, l.targetPortLabel],
      [e.target, l.targetPortLabel, e.source, l.sourcePortLabel],
    ] as const;
    for (const [here, port, there, farPort] of ends) {
      const far = names.get(there);
      if (!names.has(here) || far === undefined) continue;
      const text = `${port ? `${port} to ` : ''}${far}${farPort ? ` ${farPort}` : ''}`;
      cabled.set(here, [...(cabled.get(here) ?? []), text]);
    }
  }
  const rows = devices
    .map(({ id, d, page }) => {
      const primary = d.addresses?.find((a) => a.isPrimary) ?? d.addresses?.[0];
      const others = (d.addresses ?? []).filter((a) => a !== primary && a.address);
      const ports = d.inventory?.ports ?? [];
      const up = ports.filter((p) => /^(connected|up)$/i.test(p.status)).length;
      return [
        d.label, d.hostname ?? '', d.deviceType, d.role ?? '', d.vendor ?? '', d.model ?? '', d.serial ?? '', d.assetTag ?? '',
        d.osVersion ?? '', primary?.address ?? '',
        others.map((a) => (a.label ? `${a.label}: ${a.address}` : a.address)).join('; '),
        d.mac ?? '', d.site ?? '', d.rack ?? '', d.rackU ?? '', d.rackUnits ?? '',
        d.stackKind ?? '', (d.stackMembers ?? '').split('\n').filter(Boolean).join('; '),
        ports.length ? `${up} of ${ports.length}` : '',
        vlanRanges((d.inventory?.vlans ?? []).map((v) => v.id)),
        (cabled.get(id) ?? []).join('; '),
        d.inventory?.collectedAt ? new Date(d.inventory.collectedAt).toISOString() : '',
        page, d.notes ?? '',
      ];
    })
    .sort((a, b) => String(a[12]).localeCompare(String(b[12])) || String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  return toCsv([
    ['Device', 'Hostname', 'Type', 'Role', 'Vendor', 'Model', 'Serial number', 'Asset tag',
     'Software', 'Management IP', 'Other addresses', 'MAC address', 'Site', 'Rack', 'Rack U', 'Height (U)',
     'Stack', 'Stack members', 'Ports in use', 'VLANs', 'Connects to', 'Last read', 'Page', 'Notes'],
    ...rows,
  ]);
}
