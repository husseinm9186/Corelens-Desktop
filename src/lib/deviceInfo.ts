/**
 * What one device said about itself, turned into the fields the diagram
 * keeps for it.
 *
 * Only what the device actually answered is written: a field it did not
 * name keeps whatever was typed. The display name is never touched — that is
 * the drawing's, not the device's.
 *
 * Pure, so what lands where is tested without a device.
 */
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
  const source = { source: 'ssh:device info', seenAtMs: atMs };
  const evidence = { ...(had.evidence ?? {}) };
  if (said.hostname) evidence.hostname = { source: 'prompt', seenAtMs: atMs, detail: said.hostname };
  if (said.model) evidence.platform = { ...source, detail: said.model };
  if (said.serial) evidence.serial = { ...source, detail: said.serial };
  return { patch: { ...said, evidence, discoveredVia: had.discoveredVia ?? 'SSH' }, changed };
}
