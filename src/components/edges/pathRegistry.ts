/**
 * Where every drawn link puts its path so the others can see it.
 *
 * A hop needs to know about links other than the one drawing it, and an edge
 * component only knows its own geometry. Rather than lifting path computation
 * out of the edge — which would mean duplicating React Flow's own handle
 * measurement — each edge registers what it drew, and reads the register when
 * working out where to hop.
 *
 * Two things keep that from thrashing. What is registered is the plain path,
 * never the hopped one, so an edge redrawing itself with hops cannot set the
 * others recomputing. And subscribers are told after a short quiet period
 * rather than on every change, so dragging a node across a diagram does not
 * recompute every crossing on every frame — the hops settle a moment after
 * the drag instead of chasing it.
 */

/** Above this, hops are not drawn at all.
 *
 *  Crossing detection is every link against every other, which is quadratic
 *  — cheaply so, now that a path is read once and two links whose rectangles
 *  do not meet are told apart at a glance, which is what let this rise from
 *  160. On a diagram past this size the hops have also stopped helping: the
 *  picture is dense enough that the reader is using the highlight-on-hover
 *  instead. */
export const MAX_EDGES_FOR_JUMPS = 1200;

import { type Point, jumpsFor } from '../../lib/lineJumps';

const paths = new Map<string, string>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Bumped when the settled set of paths changes, so components can depend on
 *  a primitive rather than on a Map identity. */
let version = 0;

const QUIET_MS = 90;

function scheduleNotify(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    version += 1;
    for (const l of listeners) l();
  }, QUIET_MS);
}

export function registerPath(id: string, d: string): void {
  if (paths.get(id) === d) return;
  paths.set(id, d);
  scheduleNotify();
}

export function forgetPath(id: string): void {
  if (!paths.delete(id)) return;
  scheduleNotify();
}

export function pathVersion(): number {
  return version;
}

export function allPaths(): Map<string, string> {
  return paths;
}

/** The first stretch of a path, up to its first straight run — where
 *  parallel cables out of one handle coincide. */
export function pathStart(d: string): string {
  const l = d.indexOf('L');
  return d.slice(0, l > 0 ? l : 24);
}

let startsAt = -1;
let starts = new Map<string, string[]>();

/**
 * How many other links, by id, leave from exactly where this one does — so
 * parallel cables can stagger their port chips.
 *
 * Each link used to count this by walking every registered path, and
 * every link re-counted whenever any path changed. That is quadratic, and
 * dragging one device at a thousand links spent most of each frame in it. The
 * starts are indexed once per settled version of the registry instead.
 */
export function rankAtStart(id: string, d: string): number {
  if (startsAt !== version) {
    starts = new Map();
    for (const [otherId, otherPath] of paths) {
      const key = pathStart(otherPath);
      const list = starts.get(key);
      if (list) list.push(otherId);
      else starts.set(key, [otherId]);
    }
    for (const list of starts.values()) list.sort();
    startsAt = version;
  }
  const list = starts.get(pathStart(d));
  if (!list) return 0;
  // Ids ordered before this one, not counting this one.
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! < id) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A link's rank among those leaving from where it does, from the path it
 *  last registered. A number, so a link subscribed to it re-renders when its
 *  rank changes and not whenever any path anywhere does. */
export function rankOf(id: string): number {
  const d = paths.get(id);
  return d === undefined ? 0 : rankAtStart(id, d);
}

const NO_JUMPS: readonly Point[] = [];
let jumpsAt = -1;
let jumps = new Map<string, readonly Point[]>();
let jumpsBefore = new Map<string, readonly Point[]>();

/**
 * Where a link hops over the links it crosses, as of the settled register.
 *
 * Worked out once per settled version for whichever link asks, and the array
 * a link was given last time is handed back when its hops have not moved — so
 * a link subscribed to this re-renders when its own crossings change, where
 * every link used to re-render every time any path settled.
 */
export function jumpPointsOf(id: string, minGap: number): readonly Point[] {
  if (jumpsAt !== version) {
    jumpsBefore = jumps;
    jumps = new Map();
    jumpsAt = version;
  }
  const hit = jumps.get(id);
  if (hit) return hit;
  const d = paths.get(id);
  let found: readonly Point[] = NO_JUMPS;
  if (d !== undefined && paths.size <= MAX_EDGES_FOR_JUMPS) {
    const points = jumpsFor(id, d, paths, minGap);
    if (points.length > 0) {
      const was = jumpsBefore.get(id);
      const same = was && was.length === points.length && was.every((p, i) => p.x === points[i]!.x && p.y === points[i]!.y);
      found = same ? was : points;
    }
  }
  jumps.set(id, found);
  return found;
}

export function subscribePaths(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: the register is module state and would otherwise leak between
 *  cases. */
export function resetPaths(): void {
  paths.clear();
  startsAt = -1;
  starts = new Map();
  if (timer) clearTimeout(timer);
  timer = null;
  version = 0;
  jumpsAt = -1;
  jumps = new Map();
  jumpsBefore = new Map();
}
