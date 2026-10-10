/**
 * The register's subnet tree, as rows: containers with what they hold,
 * subnets under them, and the subnets in no container after. Each carries
 * how full it is, so the tree answers "where is there room" at a glance.
 */
import type { IpamBlock, IpamContainerNode, IpamModel } from './ipam';

export interface SubnetTreeRow {
  /** `c:<id>` for a container, `<vrf>|<cidr>` for a subnet — the key the
   *  workbench's pickers already use. */
  key: string;
  kind: 'container' | 'subnet';
  depth: number;
  cidr: string;
  name: string;
  used: number;
  usable: number;
  /** Whether it has anything under it to open. */
  parent: boolean;
  open: boolean;
}

export const subnetKey = (b: Pick<IpamBlock, 'vrfId' | 'cidr'>): string => `${b.vrfId}|${b.cidr}`;

/** How full, as a band: the meter's colour. */
export function fillBand(used: number, usable: number): 'low' | 'high' | 'full' {
  const pct = usable > 0 ? (used / usable) * 100 : 0;
  return pct >= 90 ? 'full' : pct >= 75 ? 'high' : 'low';
}

/**
 * The rows to draw, given which containers are open. A container nobody has
 * closed is open, so a small register shows everything at once.
 */
export function subnetTreeRows(model: IpamModel, closed: ReadonlySet<string>, vrfId = ''): SubnetTreeRow[] {
  const inVrf = <T extends { vrfId: string }>(xs: readonly T[]) => (vrfId ? xs.filter((x) => x.vrfId === vrfId) : xs);
  const rows: SubnetTreeRow[] = [];
  const subnet = (b: IpamBlock, depth: number) =>
    rows.push({ key: subnetKey(b), kind: 'subnet', depth, cidr: b.cidr, name: b.name ?? '', used: b.used, usable: b.usable, parent: false, open: false });
  const walk = (c: IpamContainerNode, depth: number) => {
    const key = `c:${c.id}`;
    const open = !closed.has(key);
    rows.push({ key, kind: 'container', depth, cidr: c.cidr, name: c.name, used: c.used, usable: c.usable, parent: c.children.length + c.subnets.length > 0, open });
    if (!open) return;
    for (const child of c.children) walk(child, depth + 1);
    for (const b of c.subnets) subnet(b, depth + 1);
  };
  for (const c of inVrf(model.containers)) walk(c, 0);
  const held = new Set(
    model.containers.flatMap(function all(c: IpamContainerNode): string[] {
      return [...c.subnets.map(subnetKey), ...c.children.flatMap(all)];
    }),
  );
  for (const b of inVrf(model.blocks)) if (!held.has(subnetKey(b))) subnet(b, 0);
  return rows;
}
