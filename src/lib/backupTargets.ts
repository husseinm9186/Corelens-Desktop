/**
 * What a backup can be taken of: the diagram's devices, every page of it.
 *
 * A device's configuration does not care which page it is drawn on — and a
 * device drawn on two pages is still one device, logged in to once and filed
 * once. It is one target by its address; what each drawing of it adds (a
 * role, tags, its own commands) is put together.
 *
 * Pure, so the list is tested without a panel.
 */
import { commandsFor, setsFor, type CommandSet } from './commandSets';
import { parseCommandList } from './showCommands';

export interface DrawnDevice {
  label?: string;
  addresses?: { address: string; isPrimary?: boolean }[];
  showCommands?: string;
  role?: string;
  tags?: string[];
  site?: string;
}

export interface DiagramTarget {
  name: string;
  address: string;
  role: string | undefined;
  tags: string[];
  site: string;
  commands: string[];
  /** How many commands are the device's own, not a set's. */
  own: number;
  setNames: string[];
}

const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.includes(x))];

export function diagramTargets(devices: DrawnDevice[], sets: CommandSet[], projectSite: string): DiagramTarget[] {
  const byAddress = new Map<string, DiagramTarget>();
  for (const data of devices) {
    const address = (data.addresses?.find((a) => a.isPrimary)?.address ?? data.addresses?.[0]?.address ?? '').trim();
    if (!address) continue;
    const one: DiagramTarget = {
      name: data.label ?? 'device',
      address,
      // What command sets and collection groups match on.
      role: data.role,
      tags: data.tags ?? [],
      // The device's own Site, else the project's, for `{site}`.
      site: data.site?.trim() || projectSite,
      // Matching sets first, then the device's own list.
      commands: commandsFor(sets, data),
      own: parseCommandList(data.showCommands).length,
      setNames: setsFor(sets, data).map((s) => s.name || 'unnamed set'),
    };
    const had = byAddress.get(address);
    if (!had) {
      byAddress.set(address, one);
      continue;
    }
    // The same device drawn again: one target, with what this drawing adds.
    const ownBefore = had.commands.length;
    had.commands = union(had.commands, one.commands);
    had.own += had.commands.length - ownBefore;
    had.tags = union(had.tags, one.tags);
    had.setNames = union(had.setNames, one.setNames);
    had.role = had.role ?? one.role;
  }
  return [...byAddress.values()];
}
