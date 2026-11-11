/**
 * Where every link on a page meets its devices, and the lane it runs in.
 *
 * A link used to work its own geometry out, alone: each end aimed at the far
 * device and met whatever outline was in the way, and each orthogonal link
 * turned at the same halfway line as every other. Looked at one link at a
 * time that is defensible. Looked at as a page it is why links ended inside a
 * device's drawing, why six links left one device from one point, and why
 * their long runs lay on top of one another.
 *
 * So the page is laid out in one pass, and every link reads its own answer:
 *
 *   - **Ends are on the ring.** A device drawn as a glyph is met on the ring
 *     round it — the circle that marks it selected, and where its connection
 *     points sit — at any angle. A box (a card, a note, a drawn shape) is met
 *     on its edge. An end placed by hand stays where it was put; projected
 *     onto the ring, so an anchor saved before the ring existed lands on it.
 *   - **Ends that share a side share it out.** The links leaving one side of
 *     a device are spread along it in the order of where they are going, so
 *     no two start at the same point and none cross on the way out.
 *   - **Runs that share a channel take a track each.** Orthogonal links whose
 *     middle runs would lie along the same line between two tiers are given
 *     parallel tracks, ordered so a link does not cross a neighbour it has no
 *     need to cross.
 *   - **Every corner is a right angle.** A routed link is a list of corner
 *     points, horizontal and vertical runs only; a route bent by hand keeps
 *     its end runs square when its devices move.
 *
 * Pure geometry: no React, no store. The canvas and the export both call it,
 * so a link is in the same place in both.
 */
import { type Rect, routeAround, simplify } from './avoidRoute';
import { type Anchor, type Box, anchorPoint } from './floatingAnchor';
import { anchorSide, labelledPortAnchor, portedOf } from './portPoints';
import type { Side } from './routeLinks';
import { type DeviceNodeData, type LinkData, SHAPE_DEVICE_TYPES } from '../types/domain';

export interface Pt {
  x: number;
  y: number;
}

/** A device's outline as links meet it: a box, or the ring round a glyph. */
export interface Shape extends Box {
  round: boolean;
}

/** One end of a link: the point on its device's outline, and the side of the
 *  device it is on — which is the way the link leaves. */
export interface LinkEnd extends Pt {
  side: Side;
}

export interface LinkLayout {
  s: LinkEnd;
  t: LinkEnd;
  /** The corner points of an orthogonal link, ends included; null for a
   *  straight or curved link, which needs only its ends. */
  points: Pt[] | null;
  /** The bottom of each end's device, where its name hangs — so a link's
   *  labels can keep clear of it without the link watching the device. */
  sBottom: number;
  tBottom: number;
}

/** How far outside a glyph's box its ring is drawn. The stylesheet's
 *  `.cv-glyph-art::after { inset: -6px }` is the same number. */
export const RING_GAP = 6;
/** The spacing between link ends sharing one side of a device. */
export const SLOT_GAP = 12;
/** The spacing between parallel runs sharing a channel. */
export const TRACK_GAP = 10;
/** How far a routed link runs straight out of a device before it may turn. */
export const STUB = 18;

const DIR: Record<Side, Pt> = { l: { x: -1, y: 0 }, r: { x: 1, y: 0 }, t: { x: 0, y: -1 }, b: { x: 0, y: 1 } };
const OPPOSITE: Record<Side, Side> = { t: 'b', b: 't', l: 'r', r: 'l' };
/** The angle of each side's middle, in the screen's y-down coordinates. */
const SIDE_ANGLE: Record<Side, number> = { r: 0, b: Math.PI / 2, l: Math.PI, t: -Math.PI / 2 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const centre = (s: Box): Pt => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
const radii = (s: Shape) => ({ rx: s.w / 2 + RING_GAP, ry: s.h / 2 + RING_GAP });

/** Where a ray from the shape's centre through `p` leaves its outline. A
 *  point at the centre has no bearing and is sent out of the right-hand side. */
export function projectToOutline(s: Shape, p: Pt): Pt {
  const c = centre(s);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (s.round) {
    const { rx, ry } = radii(s);
    if (dx === 0 && dy === 0) return { x: c.x + rx, y: c.y };
    const k = 1 / Math.hypot(dx / rx, dy / ry);
    return { x: c.x + dx * k, y: c.y + dy * k };
  }
  const hw = s.w / 2;
  const hh = s.h / 2;
  if ((dx === 0 && dy === 0) || hw <= 0 || hh <= 0) return { x: c.x + hw, y: c.y };
  const k = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy));
  return { x: c.x + dx * k, y: c.y + dy * k };
}

/** The point of a box's own edge nearest `p` — how a hand-placed end stays
 *  exactly where it was put on a box, rather than sliding along a ray. */
function nearestOnBox(s: Box, p: Pt): Pt {
  const x = Math.min(s.x + s.w, Math.max(s.x, p.x));
  const y = Math.min(s.y + s.h, Math.max(s.y, p.y));
  const d = { l: x - s.x, r: s.x + s.w - x, t: y - s.y, b: s.y + s.h - y };
  const side = (Object.keys(d) as Side[]).reduce((best, k) => (d[k] < d[best] ? k : best));
  if (side === 'l') return { x: s.x, y };
  if (side === 'r') return { x: s.x + s.w, y };
  if (side === 't') return { x, y: s.y };
  return { x, y: s.y + s.h };
}

/** A point of the outline, as an anchor normalised to the box — the form a
 *  hand-placed end is saved in. On a ring it lies a little outside 0..1. */
export function outlineAnchor(s: Shape, p: Pt): Anchor {
  const q = s.round ? projectToOutline(s, p) : nearestOnBox(s, p);
  return { x: (q.x - s.x) / s.w, y: (q.y - s.y) / s.h };
}

/** Which side of its shape an outline point is on. */
export function sideAt(s: Shape, p: Pt): Side {
  const c = centre(s);
  // Scaled to the shape, so a wide box's top is still its top out at the ends.
  const dx = (p.x - c.x) / Math.max(1, s.w);
  const dy = (p.y - c.y) / Math.max(1, s.h);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'r' : 'l';
  return dy > 0 ? 'b' : 't';
}

/** The outermost coordinate of a side, along the axis it faces. */
function extreme(s: Shape, side: Side): number {
  const g = s.round ? RING_GAP : 0;
  if (side === 't') return s.y - g;
  if (side === 'b') return s.y + s.h + g;
  if (side === 'l') return s.x - g;
  return s.x + s.w + g;
}

/**
 * The side of `a` that faces `b`.
 *
 * Network diagrams are drawn in tiers, so a device on the tier below is met
 * from the bottom even when it is a long way across — a distribution switch's
 * links fan down to its access switches, they do not leave by its side and
 * double back, through its neighbours on the same tier. So: top or bottom
 * whenever there is room between the two, up and down, for a link to leave
 * one and arrive at the other; left or right for devices in a row. Two that
 * overlap go by whichever way they are further apart.
 */
export function facingSide(a: Box, b: Box): Side {
  const ca = centre(a);
  const cb = centre(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const gapX = Math.abs(dx) - (a.w + b.w) / 2;
  const gapY = Math.abs(dy) - (a.h + b.h) / 2;
  const room = 2 * STUB + 12;
  const vertical = dy > 0 ? 'b' : 't';
  const horizontal = dx > 0 ? 'r' : 'l';
  if (gapY >= room) return vertical;
  if (gapX >= room) return horizontal;
  return Math.abs(dx) > Math.abs(dy) * 1.2 ? horizontal : vertical;
}

/**
 * Slot `index` of `count` on one side of a shape: the middle of the side for
 * a link on its own, spread evenly about the middle for several. On a ring the
 * slots follow the arc; the spread is held inside the side's own quarter so
 * the outermost slot never wanders onto the next side.
 */
export function slotPoint(s: Shape, side: Side, index: number, count: number): Pt {
  const c = centre(s);
  const horizontalSide = side === 't' || side === 'b';
  // Along +x on a top or bottom side, along +y on a left or right side.
  const k = index - (count - 1) / 2;
  if (s.round) {
    const { rx, ry } = radii(s);
    const r = horizontalSide ? rx : ry;
    const room = (Math.PI / 2) * 0.72 * r; // of the quarter arc this side owns
    const gap = count > 1 ? Math.min(SLOT_GAP, room / (count - 1)) : 0;
    // Increasing offset moves along +x (or +y); on the bottom and the left
    // that is against the direction the angle grows.
    const sign = side === 'b' || side === 'l' ? -1 : 1;
    const a = SIDE_ANGLE[side] + (sign * k * gap) / Math.max(1, r);
    return { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry };
  }
  const length = horizontalSide ? s.w : s.h;
  const gap = count > 1 ? Math.min(SLOT_GAP, (length * 0.8) / (count - 1)) : 0;
  if (side === 't') return { x: c.x + k * gap, y: s.y };
  if (side === 'b') return { x: c.x + k * gap, y: s.y + s.h };
  if (side === 'l') return { x: s.x, y: c.y + k * gap };
  return { x: s.x + s.w, y: c.y + k * gap };
}

/**
 * The corners of an orthogonal link between two ends, each leaving square to
 * its own side: straight out by `stub`, then the fewest turns that arrive
 * square at the other end. `mid` is where the middle run of two facing ends
 * lies — the channel track — and halfway when not given.
 */
export function orthoPoints(s: LinkEnd, t: LinkEnd, opts: { stub?: number; mid?: number | null } = {}): Pt[] {
  const offset = opts.stub ?? STUB;
  const sd = DIR[s.side];
  const td = DIR[t.side];
  const sg = { x: s.x + sd.x * offset, y: s.y + sd.y * offset };
  const tg = { x: t.x + td.x * offset, y: t.y + td.y * offset };
  const acc: 'x' | 'y' = s.side === 'l' || s.side === 'r' ? 'x' : 'y';
  const opp: 'x' | 'y' = acc === 'x' ? 'y' : 'x';
  const curr = sg[acc] < tg[acc] ? 1 : -1;
  const sOff = { x: 0, y: 0 };
  const tOff = { x: 0, y: 0 };
  let between: Pt[];

  if (sd[acc] * td[acc] === -1) {
    // Facing opposite ways along one axis.
    const ahead = sd[acc] === curr;
    const cx = acc === 'x' && ahead && opts.mid != null ? opts.mid : (sg.x + tg.x) / 2;
    const cy = acc === 'y' && ahead && opts.mid != null ? opts.mid : (sg.y + tg.y) / 2;
    const verticalSplit = [{ x: cx, y: sg.y }, { x: cx, y: tg.y }];
    const horizontalSplit = [{ x: sg.x, y: cy }, { x: tg.x, y: cy }];
    between = ahead === (acc === 'x') ? verticalSplit : horizontalSplit;
  } else {
    const sourceTarget = [{ x: sg.x, y: tg.y }];
    const targetSource = [{ x: tg.x, y: sg.y }];
    if (acc === 'x') between = sd.x === curr ? targetSource : sourceTarget;
    else between = sd.y === curr ? sourceTarget : targetSource;
    if (s.side === t.side) {
      // Two ends on the same side and close together: without this the stub
      // and the turn land on one another and the link doubles back.
      const diff = Math.abs(s[acc] - t[acc]);
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff);
        if (sd[acc] === curr) sOff[acc] = (sg[acc] > s[acc] ? -1 : 1) * gapOffset;
        else tOff[acc] = (tg[acc] > t[acc] ? -1 : 1) * gapOffset;
      }
    } else {
      const sameDir = sd[acc] === td[opp];
      const sGt = sg[opp] > tg[opp];
      const sLt = sg[opp] < tg[opp];
      const flip =
        (sd[acc] === 1 && ((!sameDir && sGt) || (sameDir && sLt))) ||
        (sd[acc] !== 1 && ((!sameDir && sLt) || (sameDir && sGt)));
      if (flip) between = acc === 'x' ? sourceTarget : targetSource;
    }
  }
  return simplify([
    { x: s.x, y: s.y },
    { x: sg.x + sOff.x, y: sg.y + sOff.y },
    ...between,
    { x: tg.x + tOff.x, y: tg.y + tOff.y },
    { x: t.x, y: t.y },
  ]);
}

/**
 * A hand-bent orthogonal route, kept square.
 *
 * The saved corners are where they were when the link was bent. Its devices
 * have since moved, or its ends have been spread along a side, so the run
 * from each end to its first saved corner is no longer straight — it used to
 * be drawn anyway, as a slant. The first and last corners are slid along the
 * runs they belong to until the end runs are square again; the rest of the
 * route is untouched.
 */
export function squareWaypoints(s: LinkEnd, waypoints: readonly Pt[], t: LinkEnd): Pt[] {
  if (waypoints.length === 0) return [];
  const pts = waypoints.map((p) => ({ ...p }));
  const vertical = (side: Side) => side === 't' || side === 'b';
  if (pts.length === 1) {
    // One corner cannot be square to both ends unless they leave on different
    // axes; then it is where the two runs meet.
    if (vertical(s.side) !== vertical(t.side)) return [vertical(s.side) ? { x: s.x, y: t.y } : { x: t.x, y: s.y }];
    const p = pts[0]!;
    return vertical(s.side) ? [{ x: s.x, y: p.y }, { x: t.x, y: p.y }] : [{ x: p.x, y: s.y }, { x: p.x, y: t.y }];
  }
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (vertical(s.side)) first.x = s.x;
  else first.y = s.y;
  if (vertical(t.side)) last.x = t.x;
  else last.y = t.y;
  // Sliding an end corner along its run keeps the next run straight only if
  // the route alternates, as a route bent on the canvas does. One that does
  // not is squared up corner by corner from the source end.
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.x === b.x || a.y === b.y) continue;
    const before = i >= 2 ? pts[i - 2]! : s;
    const cameVertical = before.x === a.x;
    if (i === pts.length - 1) pts.splice(i, 0, cameVertical ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    else if (cameVertical) b.y = a.y;
    else b.x = a.x;
  }
  return pts;
}

/**
 * Parallel routed links kept in lanes: the interior runs move sideways by `d`
 * and the corners are where the moved runs meet. The first and last runs stay
 * on their own ends, so the link still leaves and arrives square.
 */
export function laneOffsetSquare(points: readonly Pt[], d: number): Pt[] {
  if (d === 0 || points.length < 4) return points.map((p) => ({ ...p }));
  const n = points.length - 1; // number of runs
  const lines = points.slice(1).map((p, i) => {
    const a = points[i]!;
    const horizontal = a.y === p.y;
    const dir = horizontal ? Math.sign(p.x - a.x) : Math.sign(p.y - a.y);
    const shift = i === 0 || i === n - 1 ? 0 : d;
    return horizontal ? { horizontal, at: a.y - dir * shift } : { horizontal, at: a.x + dir * shift };
  });
  const out: Pt[] = [{ ...points[0]! }];
  for (let i = 1; i < points.length - 1; i++) {
    const before = lines[i - 1]!;
    const after = lines[i]!;
    if (before.horizontal === after.horizontal) out.push({ ...points[i]! });
    else out.push(before.horizontal ? { x: after.at, y: before.at } : { x: before.at, y: after.at });
  }
  out.push({ ...points[points.length - 1]! });
  return simplify(out);
}

// ---------------------------------------------------------------------------

type LayoutNode = {
  id: string;
  type?: string;
  position: Pt;
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
  data?: unknown;
};
type LayoutEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: unknown;
};

export interface LayoutOptions {
  /** A node's outline as links meet it. */
  shapeOf: (n: LayoutNode) => Shape;
  /** The box a hand-placed anchor is normalised to; the shape's own box when
   *  not given. (The export draws a glyph smaller than the node's box.) */
  anchorBoxOf?: (n: LayoutNode) => Box;
  /** The boxes a routed (`auto`) link goes round. Read only when a page has
   *  such links. */
  obstacles?: () => Rect[];
  /** Routes found on an earlier pass over the same page, kept by the caller.
   *  A drag lays the page out every frame, and finding a way round the
   *  devices is the one costly step; a link whose ends have not moved, with
   *  no device moved near it, takes the route it had. */
  routes?: RouteCache;
}

export interface RouteCache {
  /** Each obstacle's place last time, by `x,y,w,h`. */
  placed: Set<string>;
  routes: Map<string, { key: string; points: Pt[]; x1: number; y1: number; x2: number; y2: number }>;
}

export function newRouteCache(): RouteCache {
  return { placed: new Set(), routes: new Map() };
}

/** How far from a link a moved device can change its route: the router's own
 *  reach, and its clearance. */
const ROUTE_REACH = 420;

const isSide = (h: unknown): h is Side => h === 't' || h === 'r' || h === 'b' || h === 'l';
const ORTHO = new Set(['step', 'smoothstep', 'auto', 'avoid']);

/** A coarse grid over the obstacles, so a link is tested against the devices
 *  near it and not against every device on the page. */
class ObstacleGrid {
  private readonly cells = new Map<string, Rect[]>();
  private static readonly CELL = 240;
  constructor(rects: readonly Rect[]) {
    const C = ObstacleGrid.CELL;
    for (const r of rects) {
      for (let i = Math.floor(r.x / C); i <= Math.floor((r.x + r.w) / C); i++) {
        for (let j = Math.floor(r.y / C); j <= Math.floor((r.y + r.h) / C); j++) {
          const key = `${i}:${j}`;
          const list = this.cells.get(key);
          if (list) list.push(r);
          else this.cells.set(key, [r]);
        }
      }
    }
  }
  /** Whether the run from `a` to `b` passes through any obstacle but `skip`. */
  blocked(a: Pt, b: Pt, skip: ReadonlySet<Rect>): boolean {
    const C = ObstacleGrid.CELL;
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    for (let i = Math.floor(x1 / C); i <= Math.floor(x2 / C); i++) {
      for (let j = Math.floor(y1 / C); j <= Math.floor(y2 / C); j++) {
        for (const r of this.cells.get(`${i}:${j}`) ?? []) {
          if (skip.has(r)) continue;
          if (x2 > r.x && x1 < r.x + r.w && y2 > r.y && y1 < r.y + r.h) return true;
        }
      }
    }
    return false;
  }
}

const ROUTE_SIDE = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const;

/**
 * Lays out every link on a page. `nodes` and `edges` are the page as it is
 * being drawn — a device mid-drag where the drag has it.
 */
export function layoutLinks(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  opts: LayoutOptions,
): Map<string, LinkLayout> {
  const byId = new Map<string, LayoutNode>();
  for (const n of nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const shapes = new Map<string, Shape>();
  const shapeOf = (n: LayoutNode) => {
    let s = shapes.get(n.id);
    if (!s) {
      s = opts.shapeOf(n);
      shapes.set(n.id, s);
    }
    return s;
  };

  interface Pending {
    edge: LayoutEdge;
    data: LinkData;
    sNode: LayoutNode;
    tNode: LayoutNode;
    s: LinkEnd | null;
    t: LinkEnd | null;
  }
  const pending: Pending[] = [];
  /** The automatic ends waiting for a slot, by device and side. */
  const groups = new Map<string, { p: Pending; end: 's' | 't'; key: number }[]>();

  const resolve = (p: Pending, which: 's' | 't'): LinkEnd | null => {
    const self = which === 's' ? p.sNode : p.tNode;
    const other = which === 's' ? p.tNode : p.sNode;
    const shape = shapeOf(self);
    const anchor = which === 's' ? p.data.sourceAnchor : p.data.targetAnchor;
    const fixed = (at: Pt, side?: Side): LinkEnd => {
      const q = shape.round ? projectToOutline(shape, at) : at;
      return { x: round2(q.x), y: round2(q.y), side: side ?? sideAt(shape, q) };
    };
    if (anchor) return fixed(anchorPoint(opts.anchorBoxOf?.(self) ?? shape, anchor));

    const otherShape = shapeOf(other);
    let side: Side;
    if (p.data.pinnedSides && !p.data.sourceAnchor && !p.data.targetAnchor) {
      // Pinned to the side it was drawn from: that is what pinning means. A
      // link with one end placed by hand is marked pinned too, but its other
      // end was never given a side by anyone — it goes on facing its device.
      const handle = which === 's' ? p.edge.sourceHandle : p.edge.targetHandle;
      side = isSide(handle) ? handle : which === 's' ? 'r' : 'l';
    } else {
      // A link whose port label names a port the device has lands on that port.
      const d = self.data as DeviceNodeData | undefined;
      if (shape.round && d && self.type === 'device' && !d.imageDataUrl) {
        const label = which === 's' ? p.data.sourcePortLabel : p.data.targetPortLabel;
        // Ports are laid along the drawing, which is the shape's own box.
        const atPort = label ? labelledPortAnchor(shape, portedOf(d), label, centre(otherShape)) : null;
        // …and leaves by the edge of the drawing that port is on: the last
        // port of a row along the top is round at the ring's shoulder, and
        // still a port on the top.
        if (atPort) return fixed(anchorPoint(shape, atPort), anchorSide(shape, portedOf(d), atPort));
      }
      side = which === 's' ? facingSide(shape, otherShape) : OPPOSITE[facingSide(otherShape, shape)];
    }
    const oc = centre(otherShape);
    const key = side === 't' || side === 'b' ? oc.x : oc.y;
    const groupKey = `${self.id}\u0000${side}`;
    const list = groups.get(groupKey);
    const entry = { p, end: which, key };
    if (list) list.push(entry);
    else groups.set(groupKey, [entry]);
    return null;
  };

  for (const edge of edges) {
    const sNode = byId.get(edge.source);
    const tNode = byId.get(edge.target);
    if (!sNode || !tNode) continue;
    const p: Pending = { edge, data: (edge.data ?? {}) as LinkData, sNode, tNode, s: null, t: null };
    p.s = resolve(p, 's');
    p.t = resolve(p, 't');
    pending.push(p);
  }

  // Each side's ends, in the order of where they go — and by id among links
  // to the same place, which is the same order at both ends of a parallel
  // pair, so the pair runs side by side instead of crossing.
  for (const [groupKey, list] of groups) {
    const side = groupKey.slice(groupKey.lastIndexOf('\u0000') + 1) as Side;
    list.sort((a, b) => a.key - b.key || (a.p.edge.id < b.p.edge.id ? -1 : a.p.edge.id > b.p.edge.id ? 1 : 0));
    list.forEach(({ p, end }, i) => {
      const shape = shapeOf(end === 's' ? p.sNode : p.tNode);
      const at = slotPoint(shape, side, i, list.length);
      const value = { x: round2(at.x), y: round2(at.y), side };
      if (end === 's') p.s = value;
      else p.t = value;
    });
  }

  // --- tracks for the orthogonal links whose middle runs share a channel ---
  interface Run {
    p: Pending;
    /** True when the middle run is horizontal (the link flows down or up). */
    horizontal: boolean;
    /** The channel's own centre line, and the room either side of it. */
    centre: number;
    lo: number;
    hi: number;
    /** The transverse coordinate of the end nearer the top (or left), and of
     *  the other. */
    near: number;
    far: number;
    min: number;
    max: number;
    mid: number;
  }
  const runs: Run[] = [];
  const ortho = pending.filter((p) => ORTHO.has(p.data.pathType ?? 'smoothstep') && !(p.data.waypoints?.length));
  for (const p of ortho) {
    const s = p.s!;
    const t = p.t!;
    if (s.side !== OPPOSITE[t.side]) continue;
    const horizontal = s.side === 't' || s.side === 'b';
    const main = horizontal ? 'y' : 'x';
    const cross = horizontal ? 'x' : 'y';
    const sd = DIR[s.side][main];
    // Facing each other with room for both stubs; anything else loops round
    // and has no shared channel to take a track in.
    if ((t[main] - s[main]) * sd < 2 * STUB + 4) continue;
    if (Math.abs(s[cross] - t[cross]) < 0.5) continue; // a straight drop has no middle run
    const a = extreme(shapeOf(p.sNode), s.side);
    const b = extreme(shapeOf(p.tNode), t.side);
    const sFirst = s[main] < t[main];
    runs.push({
      p,
      horizontal,
      centre: (a + b) / 2,
      min: Math.min(s[main], t[main]) + STUB,
      max: Math.max(s[main], t[main]) - STUB,
      lo: Math.min(s[cross], t[cross]),
      hi: Math.max(s[cross], t[cross]),
      near: sFirst ? s[cross] : t[cross],
      far: sFirst ? t[cross] : s[cross],
      mid: (a + b) / 2,
    });
  }
  for (const horizontal of [true, false]) {
    const set = runs.filter((r) => r.horizontal === horizontal).sort((a, b) => a.centre - b.centre);
    // A channel: runs whose centre lines are within a track's reach of the next.
    let i = 0;
    while (i < set.length) {
      let j = i + 1;
      while (j < set.length && set[j]!.centre - set[j - 1]!.centre <= TRACK_GAP * 1.6) j++;
      assignTracks(set.slice(i, j));
      i = j;
    }
  }

  // --- the result ---
  const out = new Map<string, LinkLayout>();
  let grid: ObstacleGrid | null = null;
  let rects: Rect[] = [];
  const rectOf = new Map<string, Rect>();
  const pairs = new Map<string, string[]>();
  const moved: Rect[] = [];
  const midOf = new Map<Pending, number>();
  for (const r of runs) midOf.set(r.p, r.mid);

  for (const p of pending) {
    const s = p.s!;
    const t = p.t!;
    const kind = p.data.pathType ?? 'smoothstep';
    let points: Pt[] | null = null;
    if (ORTHO.has(kind) && !(p.data.waypoints?.length)) {
      points = orthoPoints(s, t, { mid: midOf.get(p) ?? null });
      if ((kind === 'auto' || kind === 'avoid') && opts.obstacles) {
        if (!grid) {
          rects = opts.obstacles();
          grid = new ObstacleGrid(rects);
          // The page's own devices, to know which two a link belongs to.
          const byPlace = new Map<string, Rect>();
          for (const r of rects) byPlace.set(`${r.x},${r.y},${r.w},${r.h}`, r);
          for (const n of nodes) {
            const sh = shapeOf(n);
            const hit = byPlace.get(`${sh.x},${sh.y},${sh.w},${sh.h}`);
            if (hit) rectOf.set(n.id, hit);
          }
          for (const e of edges) {
            const key = e.source < e.target ? `${e.source}\u0000${e.target}` : `${e.target}\u0000${e.source}`;
            const list = pairs.get(key);
            if (list) list.push(e.id);
            else pairs.set(key, [e.id]);
          }
          for (const list of pairs.values()) list.sort();
          // The devices that are somewhere they were not last time, old place
          // and new: a route near either may no longer be the best one.
          if (opts.routes) {
            const now = new Set<string>();
            for (const r of rects) now.add(`${r.x},${r.y},${r.w},${r.h}`);
            const boxOf = (key: string): Rect => {
              const [x, y, w, h] = key.split(',').map(Number) as [number, number, number, number];
              return { x, y, w, h };
            };
            for (const key of now) if (!opts.routes.placed.has(key)) moved.push(boxOf(key));
            for (const key of opts.routes.placed) if (!now.has(key)) moved.push(boxOf(key));
            opts.routes.placed = now;
          }
        }
        const pairKey = p.edge.source < p.edge.target ? `${p.edge.source}\u0000${p.edge.target}` : `${p.edge.target}\u0000${p.edge.source}`;
        const siblings = pairs.get(pairKey) ?? [p.edge.id];
        const lane = (siblings.indexOf(p.edge.id) - (siblings.length - 1) / 2) * TRACK_GAP;
        const routeKey = `${s.x},${s.y},${s.side}|${t.x},${t.y},${t.side}|${lane}|${points.map((q) => `${q.x},${q.y}`).join(' ')}`;
        const kept = opts.routes?.routes.get(p.edge.id);
        if (
          kept && kept.key === routeKey &&
          !moved.some((m) => m.x < kept.x2 && m.x + m.w > kept.x1 && m.y < kept.y2 && m.y + m.h > kept.y1)
        ) {
          out.set(p.edge.id, { s, t, points: kept.points, sBottom: shapeOf(p.sNode).y + shapeOf(p.sNode).h, tBottom: shapeOf(p.tNode).y + shapeOf(p.tNode).h });
          continue;
        }
        // A link is never in the way of its own two devices: its stubs lead
        // out of them, and the simple route is square to both.
        const own = new Set<Rect>();
        const a = rectOf.get(p.sNode.id);
        const b = rectOf.get(p.tNode.id);
        if (a) own.add(a);
        if (b) own.add(b);
        let blocked = false;
        for (let i = 1; i < points.length && !blocked; i++) blocked = grid.blocked(points[i - 1]!, points[i]!, own);
        if (blocked) {
          const route = routeAround(s, ROUTE_SIDE[s.side], t, ROUTE_SIDE[t.side], rects);
          if (route) points = laneOffsetSquare(route, lane);
        }
        points = points.map((q) => ({ x: round2(q.x), y: round2(q.y) }));
        if (opts.routes) {
          let x1 = Infinity;
          let y1 = Infinity;
          let x2 = -Infinity;
          let y2 = -Infinity;
          for (const q of points) {
            x1 = Math.min(x1, q.x);
            y1 = Math.min(y1, q.y);
            x2 = Math.max(x2, q.x);
            y2 = Math.max(y2, q.y);
          }
          opts.routes.routes.set(p.edge.id, { key: routeKey, points, x1: x1 - ROUTE_REACH, y1: y1 - ROUTE_REACH, x2: x2 + ROUTE_REACH, y2: y2 + ROUTE_REACH });
        }
      } else {
        points = points.map((q) => ({ x: round2(q.x), y: round2(q.y) }));
      }
    }
    const sShape = shapeOf(p.sNode);
    const tShape = shapeOf(p.tNode);
    out.set(p.edge.id, { s, t, points, sBottom: sShape.y + sShape.h, tBottom: tShape.y + tShape.h });
  }
  return out;

  /** Gives each run in one channel its own track, in an order that keeps a
   *  link from crossing a neighbour it has no need to cross. */
  function assignTracks(channel: Run[]): void {
    if (channel.length === 0) return;
    // Runs that do not overlap along the channel can share a line; only a
    // cluster of overlapping ones has to be told apart.
    const sorted = [...channel].sort((a, b) => a.lo - b.lo);
    let start = 0;
    let reach = sorted[0]!.hi;
    for (let k = 1; k <= sorted.length; k++) {
      if (k < sorted.length && sorted[k]!.lo < reach) {
        reach = Math.max(reach, sorted[k]!.hi);
        continue;
      }
      spread(sorted.slice(start, k));
      start = k;
      if (k < sorted.length) reach = sorted[k]!.hi;
    }
  }

  function spread(cluster: Run[]): void {
    const n = cluster.length;
    if (n === 1) {
      const r = cluster[0]!;
      r.mid = Math.min(r.max, Math.max(r.min, r.centre));
      return;
    }
    // A run should be nearer the top than another whose line its upper end
    // would otherwise have to cross, and further than one its lower end
    // would. Counted pairwise; cheap at the sizes a channel reaches, and
    // skipped (plain order) where it would not be.
    const depth = new Map<Run, number>();
    for (const r of cluster) depth.set(r, 0);
    if (n <= 64) {
      for (const a of cluster) {
        for (const b of cluster) {
          if (a === b) continue;
          if (a.near > b.lo && a.near < b.hi) depth.set(a, depth.get(a)! - 1);
          if (a.far > b.lo && a.far < b.hi) depth.set(a, depth.get(a)! + 1);
        }
      }
    }
    const order = [...cluster].sort(
      (a, b) =>
        depth.get(a)! - depth.get(b)! ||
        a.near - b.near ||
        (a.p.edge.id < b.p.edge.id ? -1 : a.p.edge.id > b.p.edge.id ? 1 : 0),
    );
    // The middle of the channel is the median of its runs' own centre lines,
    // not their mean: one device being dragged up or down then moves its own
    // links and leaves every other run in the channel exactly where it was.
    const centres = cluster.map((r) => r.centre).sort((a, b) => a - b);
    const mid = n % 2 ? centres[(n - 1) / 2]! : (centres[n / 2 - 1]! + centres[n / 2]!) / 2;
    const lo = Math.max(...cluster.map((r) => r.min));
    const hi = Math.min(...cluster.map((r) => r.max));
    const room = Math.max(0, hi - lo);
    const gap = Math.min(TRACK_GAP, room / (n - 1));
    const first = Math.min(Math.max(mid - (gap * (n - 1)) / 2, lo), Math.max(lo, hi - gap * (n - 1)));
    order.forEach((r, k) => {
      r.mid = Math.min(r.max, Math.max(r.min, first + k * gap));
    });
  }
}

/** Whether two layouts are the same link drawn in the same place — so a link
 *  that did not move keeps the object it had and does not re-render. */
export function sameLayout(a: LinkLayout | undefined, b: LinkLayout | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.s.x !== b.s.x || a.s.y !== b.s.y || a.s.side !== b.s.side) return false;
  if (a.t.x !== b.t.x || a.t.y !== b.t.y || a.t.side !== b.t.side) return false;
  if (a.sBottom !== b.sBottom || a.tBottom !== b.tBottom) return false;
  if (a.points === null || b.points === null) return a.points === b.points;
  if (a.points.length !== b.points.length) return false;
  for (let i = 0; i < a.points.length; i++) {
    if (a.points[i]!.x !== b.points[i]!.x || a.points[i]!.y !== b.points[i]!.y) return false;
  }
  return true;
}

/**
 * A node's outline on the canvas: the ring for a device drawn as a glyph, the
 * box for everything else — a card, a note, a section, a drawn shape.
 */
export function canvasShapeOf(nodeStyle: 'glyph' | 'card'): (n: LayoutNode) => Shape {
  return (n) => ({
    x: n.position.x,
    y: n.position.y,
    w: n.width ?? n.measured?.width ?? 176,
    h: n.height ?? n.measured?.height ?? 96,
    round:
      nodeStyle === 'glyph' &&
      n.type === 'device' &&
      !SHAPE_DEVICE_TYPES.has((n.data as DeviceNodeData).deviceType),
  });
}

/**
 * Where a link end dragged to `p` lands on a ring: the point of the ring on
 * the bearing from the device's centre, eased onto the nearest eighth of a
 * turn when it is within a few degrees of one — so the top, the sides and the
 * diagonals are easy to hit exactly and every other angle is still there.
 */
export function ringSnap(s: Shape, p: Pt): Pt {
  const c = centre(s);
  const { rx, ry } = radii(s);
  if (p.x === c.x && p.y === c.y) return { x: c.x + rx, y: c.y };
  let a = Math.atan2((p.y - c.y) / ry, (p.x - c.x) / rx);
  const eighth = Math.PI / 4;
  const nearest = Math.round(a / eighth) * eighth;
  if (Math.abs(a - nearest) < (5 * Math.PI) / 180) a = nearest;
  return { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry };
}
