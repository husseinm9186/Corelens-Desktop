/**
 * What one device said about itself, turned into the fields the diagram
 * keeps for it.
 *
 * Its own interface addresses are added to the addresses its checks are made
 * from. Only what the device actually answered is written: a field it did not
 * name keeps whatever was typed. The display name is never touched — that is
 * the drawing's, not the device's.
 *
 * Pure, so what lands where is tested without a device.
 */
import { sameAddresses, withInterfaceAddresses } from './deviceAddresses';
import { sshAddress } from './sshLaunch';
import { stackFields } from './topology';
import type { DeviceInfo } from './ipc';
import type { ProjectPage } from '../state/store';
import type { DeviceNodeData } from '../types/domain';

/** The fields this fills, with the word shown for each. */
const FIELDS: [keyof DeviceNodeData, string][] = [
  ['hostname', 'hostname'],
  ['model', 'model'],
  ['serial', 'serial'],
  ['osVersion', 'software'],
  ['mac', 'MAC'],
  ['stackKind', 'stack'],
  ['stackMembers', 'stack members'],
];

export function deviceInfoPatch(
  info: DeviceInfo,
  had: DeviceNodeData,
  atMs: number,
  /** The address that was dialled: the device's management address. */
  reachedOn = '',
  newId: () => string = () => `a-${atMs}-${Math.random().toString(36).slice(2, 8)}`,
): { patch: Partial<DeviceNodeData>; changed: string[] } {
  const said: Partial<DeviceNodeData> = {
    ...(info.hostname.trim() ? { hostname: info.hostname.trim() } : {}),
    ...(info.model?.trim() ? { model: info.model.trim() } : {}),
    ...(info.serials.length ? { serial: info.serials.join(', ') } : {}),
    ...(info.software?.trim() ? { osVersion: info.software.trim() } : {}),
    ...(info.mac?.trim() ? { mac: info.mac.trim() } : {}),
    ...stackFields(info.stack),
  };
  const changed = FIELDS.filter(([key]) => said[key] !== undefined && said[key] !== had[key]).map(([, word]) => word);
  // Its own interface addresses, listed under its checks; the one it is
  // managed on stays the primary.
  const addresses = withInterfaceAddresses(had.addresses, reachedOn, info.addresses ?? [], newId);
  if (!sameAddresses(addresses, had.addresses)) {
    said.addresses = addresses;
    changed.push('interface addresses');
  }
  const source = { source: 'ssh:device info', seenAtMs: atMs };
  const evidence = { ...(had.evidence ?? {}) };
  if (said.hostname) evidence.hostname = { source: 'prompt', seenAtMs: atMs, detail: said.hostname };
  if (said.model) evidence.platform = { ...source, detail: said.model };
  if (said.serial) evidence.serial = { ...source, detail: said.serial };
  return { patch: { ...said, evidence, discoveredVia: had.discoveredVia ?? 'SSH' }, changed };
}

const bare = (address: string) => address.trim().split('/')[0]!.trim();

/**
 * What a device said, onto every drawing of it — whichever page is in front
 * when the answer arrives.
 *
 * The device that was asked is found by its id on any page: the answer took
 * a while, and whoever asked may have turned the page since. A device drawn
 * again on another page is a drawing of its own, so it is recognised by the
 * address it is managed on, which is the address that was dialled. Each
 * drawing keeps what was typed into it.
 *
 * `filled` is the ids written to, in page order; empty when the device is no
 * longer on any page, and then `pages` is the list that was passed in.
 */
export function fillDeviceInfo(
  pages: ProjectPage[],
  nodeId: string,
  info: DeviceInfo,
  atMs: number,
  reachedOn: string,
  newId?: () => string,
): { pages: ProjectPage[]; filled: string[]; changed: string[] } {
  const dialled = bare(reachedOn);
  const filled: string[] = [];
  const changed: string[] = [];
  const next = pages.map((page) => {
    let touched = false;
    const nodes = page.nodes.map((node) => {
      if (node.type !== 'device') return node;
      const had = node.data as DeviceNodeData;
      if (node.id !== nodeId && !(dialled && bare(sshAddress(had)) === dialled)) return node;
      const got = deviceInfoPatch(info, had, atMs, reachedOn, newId);
      touched = true;
      filled.push(node.id);
      for (const word of got.changed) if (!changed.includes(word)) changed.push(word);
      return { ...node, data: { ...had, ...got.patch } } as typeof node;
    });
    return touched ? { ...page, nodes } : page;
  });
  return filled.length ? { pages: next, filled, changed } : { pages, filled, changed };
}
