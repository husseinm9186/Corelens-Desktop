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
import { stackFields } from './topology';
import type { DeviceInfo } from './ipc';
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
