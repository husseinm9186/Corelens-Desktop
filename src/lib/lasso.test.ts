import { describe, expect, it } from 'vitest';

import type { TopoNode } from '../state/store';
import { addPoint, insideBox, insidePolygon, lassoed, linksThrough } from './lasso';

const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
const node = (id: string, x: number, y: number) =>
  ({ id, position: { x, y }, width: 20, height: 20 }) as TopoNode;

describe('lasso selection', () => {
  it('knows inside from outside', () => {
    expect(insidePolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(insidePolygon({ x: 150, y: 50 }, square)).toBe(false);
  });

  it('follows a concave outline', () => {
    // An L shape: the notch at the top right is outside.
    const l = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(insidePolygon({ x: 75, y: 25 }, l)).toBe(false);
    expect(insidePolygon({ x: 75, y: 75 }, l)).toBe(true);
  });

  it('selects by an object’s middle', () => {
    const nodes = [node('in', 30, 30), node('mostly-out', 95, 30), node('out', 300, 300)];
    // mostly-out's middle is at 105: outside, though its edge is inside.
    expect(lassoed(nodes, square)).toEqual(['in']);
  });

  it('encloses nothing with fewer than three points', () => {
    expect(lassoed([node('a', 0, 0)], [{ x: 0, y: 0 }, { x: 100, y: 100 }])).toEqual([]);
  });

  it('thins a slow drag', () => {
    let o = addPoint([], { x: 0, y: 0 });
    o = addPoint(o, { x: 1, y: 1 });
    o = addPoint(o, { x: 10, y: 0 });
    expect(o).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });
});

describe('the links a box or a lasso goes across', () => {
  // A link is the points along its line, in the page's coordinates.
  const across = { id: 'across', points: [{ x: 0, y: 50 }, { x: 50, y: 50 }, { x: 100, y: 50 }] };
  const away = { id: 'away', points: [{ x: 0, y: 500 }, { x: 100, y: 500 }] };
  const through = { id: 'through', points: [{ x: 40, y: 0 }, { x: 45, y: 55 }, { x: 50, y: 200 }] };

  it('a box catches every link whose line passes through it, device or no device', () => {
    expect(linksThrough([across, away, through], insideBox({ x: 30, y: 40, width: 40, height: 30 }))).toEqual(['across', 'through']);
  });

  it('and none of those that only pass by', () => {
    expect(linksThrough([across, away, through], insideBox({ x: 200, y: 200, width: 50, height: 50 }))).toEqual([]);
    expect(linksThrough([], insideBox({ x: 0, y: 0, width: 10, height: 10 }))).toEqual([]);
  });

  it('a lasso catches them the same way', () => {
    const outline = [{ x: 30, y: 40 }, { x: 70, y: 40 }, { x: 70, y: 70 }, { x: 30, y: 70 }];
    expect(linksThrough([across, away, through], (p) => insidePolygon(p, outline))).toEqual(['across', 'through']);
  });
});
