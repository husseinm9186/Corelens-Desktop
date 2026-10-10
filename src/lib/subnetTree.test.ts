import { describe, expect, it } from 'vitest';

import type { IpamBlock, IpamContainerNode, IpamModel } from './ipam';
import { fillBand, subnetTreeRows } from './subnetTree';

const block = (cidr: string, used: number, usable = 254, name = ''): IpamBlock =>
  ({ cidr, name, vrfId: 'global', used, usable, addresses: [], ranges: [], free: usable - used, excluded: 0, pooled: 0, network: 0, prefix: 24, origin: 'declared', nextFree: null }) as IpamBlock;
const container = (id: string, cidr: string, subnets: IpamBlock[], children: IpamContainerNode[] = []): IpamContainerNode =>
  ({ id, name: id.toUpperCase(), cidr, vrfId: 'global', network: 0, prefix: 16, children, subnets, capacity: 65536, allocated: 0, freeSpace: 0, usable: 65534, used: subnets.reduce((n, b) => n + b.used, 0) }) as IpamContainerNode;

const a = block('192.0.2.0/24', 10, 254, 'Users');
const b = block('198.51.100.0/24', 240);
const loose = block('203.0.113.0/24', 1);
const model = { blocks: [a, b, loose], vrfs: [], containers: [container('hq', '192.0.0.0/16', [a, b])], conflicts: [], loose: [], skipped: [] } as unknown as IpamModel;

describe('subnetTreeRows', () => {
  it('puts subnets under their container and the rest after', () => {
    const rows = subnetTreeRows(model, new Set());
    expect(rows.map((r) => [r.kind, r.cidr, r.depth])).toEqual([
      ['container', '192.0.0.0/16', 0],
      ['subnet', '192.0.2.0/24', 1],
      ['subnet', '198.51.100.0/24', 1],
      ['subnet', '203.0.113.0/24', 0],
    ]);
    expect(rows[1]!.key).toBe('global|192.0.2.0/24');
  });

  it('hides what a closed container holds', () => {
    const rows = subnetTreeRows(model, new Set(['c:hq']));
    expect(rows.map((r) => r.cidr)).toEqual(['192.0.0.0/16', '203.0.113.0/24']);
    expect(rows[0]!.open).toBe(false);
    expect(rows[0]!.parent).toBe(true);
  });
});

describe('fillBand', () => {
  it('bands at 75 and 90 per cent', () => {
    expect(fillBand(10, 254)).toBe('low');
    expect(fillBand(200, 254)).toBe('high');
    expect(fillBand(240, 254)).toBe('full');
    expect(fillBand(0, 0)).toBe('low');
  });
});
