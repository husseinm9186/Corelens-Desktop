/**
 * A link's path, measured without asking the browser.
 *
 * Placing a label a distance along a link used to build an SVG `<path>`
 * element for the question and call `getPointAtLength` on it — several times
 * a link, every time the link re-rendered. That is the browser constructing
 * path geometry on the main thread in the middle of a drag, and it had no
 * answer at all outside a browser. A link's path is straight runs, small
 * rounded corners and at most one curve, so it is cut into short straight
 * pieces once and measured with arithmetic.
 */

export interface Measured {
  /** x0, y0, x1, y1, … */
  pts: Float64Array;
  /** Distance along the path at each point. */
  cum: Float64Array;
  total: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const CURVE_PIECES = 32;
const CORNER_PIECES = 4;

/** A path as a polyline: x0, y0, x1, y1, …. The commands a link's plain
 *  path uses — M, L, Q and C. */
export function flattenPath(d: string): number[] {
  const tokens = d.match(/[MLQC][^MLQC]*/gi) ?? [];
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (const token of tokens) {
    const kind = token[0]!.toUpperCase();
    const n = (token.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    if ((kind === 'M' || kind === 'L') && n.length >= 2) {
      x = n[0]!;
      y = n[1]!;
      out.push(x, y);
    } else if (kind === 'Q' && n.length >= 4) {
      for (let i = 1; i <= CORNER_PIECES; i++) {
        const t = i / CORNER_PIECES;
        const u = 1 - t;
        out.push(u * u * x + 2 * u * t * n[0]! + t * t * n[2]!, u * u * y + 2 * u * t * n[1]! + t * t * n[3]!);
      }
      x = n[2]!;
      y = n[3]!;
    } else if (kind === 'C' && n.length >= 6) {
      for (let i = 1; i <= CURVE_PIECES; i++) {
        const t = i / CURVE_PIECES;
        const u = 1 - t;
        out.push(
          u * u * u * x + 3 * u * u * t * n[0]! + 3 * u * t * t * n[2]! + t * t * t * n[4]!,
          u * u * u * y + 3 * u * u * t * n[1]! + 3 * u * t * t * n[3]! + t * t * t * n[5]!,
        );
      }
      x = n[4]!;
      y = n[5]!;
    }
  }
  return out;
}

const CACHE_LIMIT = 6000;
const cache = new Map<string, Measured>();

/** The path cut up and measured; remembered by its text. */
export function measurePath(d: string): Measured {
  const hit = cache.get(d);
  if (hit) return hit;
  const pts = Float64Array.from(flattenPath(d));
  const count = pts.length / 2;
  const cum = new Float64Array(Math.max(1, count));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = pts[i * 2]!;
    const y = pts[i * 2 + 1]!;
    if (i > 0) cum[i] = cum[i - 1]! + Math.hypot(x - pts[i * 2 - 2]!, y - pts[i * 2 - 1]!);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const out = { pts, cum, total: count > 1 ? cum[count - 1]! : 0, minX, minY, maxX, maxY };
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(d, out);
  return out;
}

/** The point `length` along a measured path, clamped to its ends; null for a
 *  path with no length. */
export function pointAtLength(m: Measured, length: number): { x: number; y: number } | null {
  if (m.total <= 0) return null;
  const want = Math.min(m.total, Math.max(0, length));
  const cum = m.cum;
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < want) lo = mid + 1;
    else hi = mid;
  }
  const span = cum[lo]! - cum[lo - 1]! || 1;
  const f = (want - cum[lo - 1]!) / span;
  const ax = m.pts[lo * 2 - 2]!;
  const ay = m.pts[lo * 2 - 1]!;
  return { x: ax + (m.pts[lo * 2]! - ax) * f, y: ay + (m.pts[lo * 2 + 1]! - ay) * f };
}

/** The point a fraction (0..1) of the way along a path. */
export function pointAtFraction(d: string, fraction: number): { x: number; y: number } | null {
  const m = measurePath(d);
  return pointAtLength(m, m.total * Math.min(1, Math.max(0, fraction)));
}

/** The fraction along the path nearest a point — exactly, piece by piece. */
export function nearestFraction(d: string, x: number, y: number): number | null {
  const m = measurePath(d);
  if (m.total <= 0) return null;
  let best = Infinity;
  let bestLength = 0;
  for (let i = 1; i < m.cum.length; i++) {
    const ax = m.pts[i * 2 - 2]!;
    const ay = m.pts[i * 2 - 1]!;
    const dx = m.pts[i * 2]! - ax;
    const dy = m.pts[i * 2 + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / len2));
    const dist = (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2;
    if (dist < best) {
      best = dist;
      bestLength = m.cum[i - 1]! + Math.sqrt(len2) * t;
    }
  }
  return bestLength / m.total;
}

/** The fraction along the path where it first reaches `y` going down; 1 when
 *  it never does. */
export function fractionWhereYReaches(d: string, y: number): number | null {
  const m = measurePath(d);
  if (m.total <= 0) return null;
  if (m.pts[1]! >= y) return 0;
  for (let i = 1; i < m.cum.length; i++) {
    const ay = m.pts[i * 2 - 1]!;
    const by = m.pts[i * 2 + 1]!;
    if (by >= y) {
      const f = by === ay ? 0 : (y - ay) / (by - ay);
      return (m.cum[i - 1]! + (m.cum[i]! - m.cum[i - 1]!) * f) / m.total;
    }
  }
  return 1;
}
