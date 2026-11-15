import { describe, expect, it } from 'vitest';

import { stackLevels } from './drawOrder';

const device = (deviceType: string) => ({ type: 'device', data: { deviceType } });
const note = { type: 'note', data: {} };

describe('draw order', () => {
  it('keeps links under everything when no shape is at the back', () => {
    const z = stackLevels([device('router'), device('rectangle'), note]);
    expect(z.links).toBe(0);
    expect(z.nodes).toEqual([1, 2, 3]);
  });

  it('draws the shapes at the back under the links, in their own order', () => {
    const z = stackLevels([device('rounded'), device('cloud'), device('router'), device('rectangle'), note]);
    expect(z.nodes.slice(0, 2)).toEqual([1, 2]);
    expect(z.links).toBeGreaterThan(2);
    // The device, the shape brought above it and the note are all over the links, in order.
    expect(z.nodes[2]).toBeGreaterThan(z.links);
    expect(z.nodes[3]).toBeGreaterThan(z.nodes[2]!);
    expect(z.nodes[4]).toBeGreaterThan(z.nodes[3]!);
  });

  it('keeps a zone a backdrop wherever it is, without ending the run of shapes behind', () => {
    const z = stackLevels([device('zone'), device('rectangle'), device('router'), device('zone')]);
    expect(z.nodes[0]).toBe(0);
    expect(z.nodes[3]).toBe(0);
    expect(z.nodes[1]).toBeLessThan(z.links);
    expect(z.nodes[2]).toBeGreaterThan(z.links);
  });

  it('puts a note at the back over the links: a note is not a shape', () => {
    const z = stackLevels([note, device('rectangle')]);
    expect(z.links).toBe(0);
    expect(z.nodes).toEqual([1, 2]);
  });
});
