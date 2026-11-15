import { describe, expect, it } from 'vitest';

import { BOX_LABEL_ROOM, BOX_MARGIN, frameAround, withBoxAtBack } from './groupBox';

const nodes = [
  { id: 'a', position: { x: 100, y: 100 }, width: 96, height: 72 },
  { id: 'b', position: { x: 400, y: 260 }, measured: { width: 100, height: 80 } },
  { id: 'c', position: { x: -500, y: -500 }, width: 10, height: 10 },
];

describe('a box round a selection', () => {
  it('frames the chosen objects and nothing else, with room for their labels', () => {
    const f = frameAround(nodes, new Set(['a', 'b']))!;
    expect(f.x).toBeLessThanOrEqual(100 - BOX_MARGIN);
    expect(f.y).toBeLessThanOrEqual(100 - BOX_MARGIN);
    expect(f.x + f.width).toBeGreaterThanOrEqual(500 + BOX_MARGIN);
    expect(f.y + f.height).toBeGreaterThanOrEqual(340 + BOX_MARGIN + BOX_LABEL_ROOM);
    // …and not out to the object that was not chosen.
    expect(f.x).toBeGreaterThan(-400);
  });

  it('lands on the grid', () => {
    const f = frameAround(nodes, new Set(['a', 'b']), { grid: 12 })!;
    for (const v of [f.x, f.y, f.width, f.height]) expect(v % 12 === 0).toBe(true);
  });

  it('sizes an object not measured yet by the fallback', () => {
    const f = frameAround([{ id: 'n', position: { x: 0, y: 0 } }], new Set(['n']), { fallback: { width: 200, height: 100 } })!;
    expect(f.x + f.width).toBeGreaterThanOrEqual(200 + BOX_MARGIN);
  });

  it('leaves room above for a title when asked', () => {
    const plain = frameAround(nodes, new Set(['a']))!;
    const titled = frameAround(nodes, new Set(['a']), { top: 24 })!;
    expect(plain.y - titled.y).toBe(24);
  });

  it('is nothing when none of them is on the page', () => {
    expect(frameAround(nodes, new Set(['zz']))).toBeNull();
    expect(frameAround(nodes, new Set())).toBeNull();
  });

  it('goes under everything', () => {
    expect(withBoxAtBack(['x', 'y'], 'box')).toEqual(['box', 'x', 'y']);
  });
});
