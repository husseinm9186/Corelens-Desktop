/**
 * A device's own interface addresses, onto the list its checks are made
 * from.
 *
 * What a device said its interfaces carry is added to the addresses it
 * already has — never instead of them: an address somebody typed, and the
 * label they gave it, stay. The address the device is managed on is the
 * primary, always; the others are listed and nothing more — no check is made
 * for them until somebody asks for one.
 *
 * Pure, so the rules are tested without a crawl.
 */
import type { NodeAddress } from '../types/domain';

export interface InterfaceAddress {
  ip: string;
  interface: string | null;
}

/** An address without the prefix length some tables print after it. */
const bare = (address: string) => address.trim().split('/')[0]!.trim();
const usable = (ip: string) => ip !== '' && !ip.startsWith('127.') && ip !== '0.0.0.0' && ip !== '::1' && /[.:]/.test(ip);

export function withInterfaceAddresses(
  had: readonly NodeAddress[] | undefined,
  /** Where the device is managed from — the address that was dialled. Empty
   *  leaves the primary where it is. */
  management: string,
  interfaces: readonly InterfaceAddress[],
  newId: () => string,
): NodeAddress[] {
  const out: NodeAddress[] = (had ?? []).map((a) => ({ ...a }));
  const find = (ip: string) => out.find((a) => bare(a.address) === ip);
  const nameOf = (ip: string) => interfaces.find((i) => bare(i.ip) === ip)?.interface?.trim() || '';

  const primary = bare(management);
  if (usable(primary)) {
    if (!find(primary)) out.unshift({ id: newId(), label: nameOf(primary) || 'Discovered', address: primary, isPrimary: true });
    for (const a of out) a.isPrimary = bare(a.address) === primary;
    // Two entries for one address is one too many to both be primary.
    let seen = false;
    for (const a of out) {
      if (!a.isPrimary) continue;
      if (seen) a.isPrimary = false;
      seen = true;
    }
  }
  for (const i of interfaces) {
    const ip = bare(i.ip);
    if (!usable(ip) || find(ip)) continue;
    out.push({ id: newId(), label: i.interface?.trim() || 'Interface', address: ip, isPrimary: false });
  }
  return out;
}

/** Whether two lists say the same thing, ids aside. */
export function sameAddresses(a: readonly NodeAddress[] | undefined, b: readonly NodeAddress[] | undefined): boolean {
  const text = (l: readonly NodeAddress[] | undefined) => (l ?? []).map((x) => `${x.label}|${x.address}|${x.isPrimary}`).join('\n');
  return text(a) === text(b);
}
