import { describe, expect, it } from 'vitest';

import {
  RING_GAP,
  SLOT_GAP,
  STUB,
  type LinkEnd,
  type Pt,
  type Shape,
  canvasShapeOf,
  facingSide,
  laneOffsetSquare,
  layoutLinks,
  newRouteCache,
  orthoPoints,
  outlineAnchor,
  projectToOutline,
  ringSnap,
  sideAt,
  slotPoint,
  squareWaypoints,
} from './linkLayout';
import { linkPath } from './linkPath';
import { obstaclesFor } from './avoidRoute';

const glyph = (id: string, x: number, y: number, deviceType = 'access-switch') => ({
  id, type: 'device', position: { x, y }, width: 76, height: 76, data: { label: id, deviceType },
});
const link = (id: string, source: string, target: string, data: Record<string, unknown> = {}) => ({
  id, source, target, sourceHandle: 'b', targetHandle: 't', data: { pathType: 'smoothstep', ...data },
});
const layout = (nodes: ReturnType<typeof glyph>[], edges: ReturnType<typeof link>[]) =>
  layoutLinks(nodes, edges, { shapeOf: canvasShapeOf('glyph'), obstacles: () => obstaclesFor(nodes) });

/** Every run of a corner list is horizontal or vertical. */
const square = (pts: readonly Pt[]) => pts.slice(1).every((p, i) => p.x === pts[i]!.x || p.y === pts[i]!.y);
const onRing = (n: ReturnType<typeof glyph>, p: Pt) =>
  Math.hypot(p.x - (n.position.x + 38), p.y - (n.position.y + 38));

describe('the outline a link meets', () => {
  const ring: Shape = { x: 0, y: 0, w: 76, h: 76, round: true };
  const box: Shape = { x: 0, y: 0, w: 200, h: 100, round: false };

  it('is the ring round a glyph, at any bearing', () => {
    for (const toward of [{ x: 500, y: 38 }, { x: 38, y: -500 }, { x: 400, y: 400 }, { x: -90, y: 12 }]) {
      const p = projectToOutline(ring, toward);
      expect(Math.hypot(p.x - 38, p.y - 38)).toBeCloseTo(38 + RING_GAP, 6);
    }
  });

  it('is the edge of a box', () => {
    expect(projectToOutline(box, { x: 900, y: 50 })).toEqual({ x: 200, y: 50 });
    expect(projectToOutline(box, { x: 100, y: 900 })).toEqual({ x: 100, y: 100 });
  });

  it('names the side a point is on', () => {
    expect(sideAt(ring, { x: 38, y: -6 })).toBe('t');
    expect(sideAt(ring, { x: 82, y: 38 })).toBe('r');
    // Out at the end of a wide box's top edge is still its top.
    expect(sideAt(box, { x: 190, y: 0 })).toBe('t');
  });

  it('saves a ring point as an anchor that comes back to the same place', () => {
    const at = ringSnap(ring, { x: 300, y: 200 });
    const a = outlineAnchor(ring, at);
    expect(a.x * 76).toBeCloseTo(at.x, 6);
    expect(a.y * 76).toBeCloseTo(at.y, 6);
  });

  it('eases a dragged end onto the top, the sides and the diagonals, and nowhere else', () => {
    // Two degrees off straight up lands exactly on the top of the ring.
    const nearTop = ringSnap(ring, { x: 38 + Math.tan((2 * Math.PI) / 180) * 100, y: 38 - 100 });
    expect(nearTop.x).toBeCloseTo(38, 6);
    expect(nearTop.y).toBeCloseTo(-RING_GAP, 6);
    // Twenty degrees off is left where it was put.
    const free = ringSnap(ring, { x: 38 + Math.tan((20 * Math.PI) / 180) * 100, y: 38 - 100 });
    expect(free.x).toBeGreaterThan(50);
  });
});

describe('slots along one side', () => {
  const ring: Shape = { x: 0, y: 0, w: 76, h: 76, round: true };

  it('puts a link on its own in the middle of the side — where the connection dot is', () => {
    expect(slotPoint(ring, 'b', 0, 1)).toEqual({ x: 38, y: 76 + RING_GAP });
    const top = slotPoint(ring, 't', 0, 1);
    expect(top.x).toBeCloseTo(38, 6);
    expect(top.y).toBeCloseTo(-RING_GAP, 6);
  });

  it('spreads several about the middle, in order, all on the ring', () => {
    for (const side of ['t', 'r', 'b', 'l'] as const) {
      const pts = [0, 1, 2, 3].map((i) => slotPoint(ring, side, i, 4));
      const along = side === 't' || side === 'b' ? pts.map((p) => p.x) : pts.map((p) => p.y);
      expect([...along].sort((a, b) => a - b)).toEqual(along);
      for (const p of pts) expect(Math.hypot(p.x - 38, p.y - 38)).toBeCloseTo(44, 6);
      // Neighbours are a slot apart along the arc, give or take its curve.
      expect(Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y)).toBeCloseTo(SLOT_GAP, 0);
    }
  });

  it('never lets a crowded side spill onto the next one', () => {
    const pts = Array.from({ length: 30 }, (_, i) => slotPoint(ring, 'b', i, 30));
    for (const p of pts) expect(sideAt(ring, p)).toBe('b');
  });
});

describe('orthoPoints', () => {
  const end = (x: number, y: number, side: LinkEnd['side']): LinkEnd => ({ x, y, side });

  it('is square whichever sides the two ends are on, wherever they are', () => {
    const sides = ['t', 'r', 'b', 'l'] as const;
    for (const a of sides) for (const b of sides) {
      for (const [x, y] of [[300, 200], [-300, 200], [300, -200], [-300, -200], [10, 200], [300, 5], [0, 0]] as const) {
        const pts = orthoPoints(end(0, 0, a), end(x, y, b));
        expect(square(pts), `${a}->${b} to ${x},${y}`).toBe(true);
        expect(pts[0]).toEqual({ x: 0, y: 0 });
        expect(pts[pts.length - 1]).toEqual({ x, y });
      }
    }
  });

  it('leaves each end straight out before it turns', () => {
    const pts = orthoPoints(end(0, 0, 'b'), end(200, 300, 't'));
    expect(pts[1]!.x).toBe(0);
    expect(pts[1]!.y).toBeGreaterThanOrEqual(STUB);
    expect(pts[pts.length - 2]!.x).toBe(200);
  });

  it('runs its middle along the track it is given', () => {
    const pts = orthoPoints(end(0, 0, 'b'), end(200, 300, 't'), { mid: 120 });
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: 200, y: 120 }, { x: 200, y: 300 }]);
  });
});

describe('layoutLinks', () => {
  it('meets every glyph on its ring', () => {
    const nodes = [glyph('a', 0, 0), glyph('b', 300, 260), glyph('c', -280, 240)];
    const out = layout(nodes, [link('1', 'a', 'b'), link('2', 'a', 'c'), link('3', 'b', 'c', { pathType: 'bezier' })]);
    for (const [id, s, t] of [['1', nodes[0]!, nodes[1]!], ['2', nodes[0]!, nodes[2]!], ['3', nodes[1]!, nodes[2]!]] as const) {
      expect(onRing(s, out.get(id)!.s)).toBeCloseTo(44, 1);
      expect(onRing(t, out.get(id)!.t)).toBeCloseTo(44, 1);
    }
  });

  it('leaves from the side facing the other device, whatever handle the link was drawn from', () => {
    const out = layout([glyph('a', 0, 0), glyph('b', 600, 20)], [link('1', 'a', 'b')]);
    expect(out.get('1')!.s.side).toBe('r');
    expect(out.get('1')!.t.side).toBe('l');
    expect(facingSide({ x: 0, y: 0, w: 76, h: 76 }, { x: 0, y: -300, w: 76, h: 76 })).toBe('t');
  });

  it('gives parallel links their own ends and keeps them from crossing', () => {
    const out = layout([glyph('a', 0, 0), glyph('b', 0, 400)], [link('1', 'a', 'b'), link('2', 'a', 'b'), link('3', 'a', 'b')]);
    const xs = (which: 's' | 't') => ['1', '2', '3'].map((id) => out.get(id)![which].x);
    expect(new Set(xs('s')).size).toBe(3);
    // The same left-to-right order at both ends.
    expect(xs('s')).toEqual([...xs('s')].sort((p, q) => p - q));
    expect(xs('t')).toEqual([...xs('t')].sort((p, q) => p - q));
  });

  it('orders a fan by where its links go, so none cross on the way out', () => {
    const nodes = [glyph('core', 300, 0), glyph('left', 0, 400), glyph('mid', 300, 400), glyph('right', 600, 400)];
    // Declared out of order on purpose.
    const out = layout(nodes, [link('1', 'core', 'right'), link('2', 'core', 'left'), link('3', 'core', 'mid')]);
    expect(out.get('2')!.s.x).toBeLessThan(out.get('3')!.s.x);
    expect(out.get('3')!.s.x).toBeLessThan(out.get('1')!.s.x);
  });

  it('routes every orthogonal link square, on every arrangement', () => {
    const nodes = [glyph('a', 0, 0), glyph('b', 420, 30), glyph('c', 200, 380), glyph('d', -260, 300), glyph('e', 210, 170)];
    const edges = [];
    let n = 0;
    for (const s of nodes) for (const t of nodes) if (s.id < t.id) for (const kind of ['smoothstep', 'step', 'auto']) edges.push(link(`l${n++}`, s.id, t.id, { pathType: kind }));
    const out = layout(nodes, edges);
    for (const e of edges) expect(square(out.get(e.id)!.points!), e.id).toBe(true);
  });

  it('gives runs that share a channel a track each', () => {
    // Two cores above four access switches: eight links whose middle runs
    // would all lie on the one line halfway down.
    const nodes = [glyph('c1', 150, 0), glyph('c2', 450, 0), ...[0, 1, 2, 3].map((i) => glyph(`a${i}`, i * 200, 400))];
    const edges = [0, 1, 2, 3].flatMap((i) => [link(`x${i}`, 'c1', `a${i}`), link(`y${i}`, 'c2', `a${i}`)]);
    const out = layout(nodes, edges);
    const mids = edges.map((e) => out.get(e.id)!.points!).filter((p) => p.length === 4).map((p) => ({ y: p[1]!.y, lo: Math.min(p[1]!.x, p[2]!.x), hi: Math.max(p[1]!.x, p[2]!.x) }));
    expect(mids.length).toBeGreaterThan(4);
    for (const a of mids) for (const b of mids) {
      if (a === b || a.y !== b.y) continue;
      // Two runs on the same line never overlap along it.
      expect(a.hi <= b.lo || b.hi <= a.lo).toBe(true);
    }
  });

  it('takes an auto link round a device in its way, and keeps it square', () => {
    const nodes = [glyph('a', 0, 0), glyph('wall', 0, 220), glyph('b', 0, 480)];
    const out = layout(nodes, [link('1', 'a', 'b', { pathType: 'auto' })]);
    const pts = out.get('1')!.points!;
    expect(square(pts)).toBe(true);
    // No run passes through the device in between.
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1]!, pts[i]!];
      const through = Math.max(p.x, q.x) > 0 && Math.min(p.x, q.x) < 76 && Math.max(p.y, q.y) > 220 && Math.min(p.y, q.y) < 296;
      expect(through, `run ${i}`).toBe(false);
    }
  });

  it('finds the same routes with a cache as without, pass after pass, as a device is dragged', () => {
    const at = (x: number) => [glyph('a', 0, 0), glyph('wall', x, 220), glyph('b', 0, 480), glyph('c', 500, 480)];
    const edges = [link('1', 'a', 'b', { pathType: 'auto' }), link('2', 'a', 'c', { pathType: 'auto' }), link('3', 'a', 'b', { pathType: 'auto' })];
    const routes = newRouteCache();
    for (const x of [0, 10, 40, 200, 400, 200, 0, 0]) {
      const nodes = at(x);
      const cached = layoutLinks(nodes, edges, { shapeOf: canvasShapeOf('glyph'), obstacles: () => obstaclesFor(nodes), routes });
      const fresh = layout(nodes, edges);
      for (const e of edges) expect(cached.get(e.id)!.points, `link ${e.id} with the wall at ${x}`).toEqual(fresh.get(e.id)!.points);
    }
  });

  it('keeps an end placed by hand where it was put, on the ring', () => {
    // Saved against the box before the ring existed: the middle of the right edge.
    const out = layout([glyph('a', 0, 0), glyph('b', 0, 400)], [link('1', 'a', 'b', { sourceAnchor: { x: 1, y: 0.5 }, pinnedSides: true })]);
    expect(out.get('1')!.s).toEqual({ x: 76 + RING_GAP, y: 38, side: 'r' });
    // …and the end nobody placed still faces its device.
    expect(out.get('1')!.t.side).toBe('t');
  });
});

describe('a route bent by hand', () => {
  const s: LinkEnd = { x: 0, y: 0, side: 'b' };
  const t: LinkEnd = { x: 300, y: 400, side: 't' };

  it('stays square when its ends have moved since it was bent', () => {
    // Bent when the ends were at x = 20 and x = 280.
    const saved = [{ x: 20, y: 150 }, { x: 280, y: 150 }];
    const pts = [s, ...squareWaypoints(s, saved, t), t];
    expect(square(pts)).toBe(true);
    expect(pts[1]).toEqual({ x: 0, y: 150 });
    expect(pts[2]).toEqual({ x: 300, y: 150 });
  });

  it('draws no slanted run for any saved route', () => {
    for (const saved of [[{ x: 50, y: 90 }], [{ x: 20, y: 150 }, { x: 280, y: 150 }], [{ x: 40, y: 80 }, { x: 40, y: 200 }, { x: 250, y: 200 }], [{ x: 10, y: 60 }, { x: 150, y: 90 }, { x: 290, y: 300 }]]) {
      expect(square([s, ...squareWaypoints(s, saved, t), t]), JSON.stringify(saved)).toBe(true);
    }
    expect(linkPath('smoothstep', { s, t, points: null }, [{ x: 20, y: 150 }, { x: 280, y: 150 }]).path.startsWith('M0,0L0,')).toBe(true);
  });

  it('shifts a routed link into its lane without slanting the ends', () => {
    const route = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 300 }];
    const shifted = laneOffsetSquare(route, 10);
    expect(square(shifted)).toBe(true);
    expect(shifted[0]).toEqual(route[0]);
    expect(shifted[shifted.length - 1]).toEqual(route[route.length - 1]);
    expect(shifted[1]!.y).not.toBe(100);
  });
});
