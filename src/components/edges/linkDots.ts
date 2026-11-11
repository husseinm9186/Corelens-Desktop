/**
 * The dots that travel along a live link, as data.
 *
 * Each dot used to be an SVG circle with its own `<animateMotion>`: six
 * elements a link, animated by the browser on the main thread. On a diagram
 * of a couple of hundred healthy links that is well over a thousand animated
 * elements, and it was most of what a frame cost for as long as monitoring
 * ran — measured at three frames in four lost on a mid-range machine, before
 * anything was dragged.
 *
 * So a link no longer draws its dots. It registers the stream here — the path,
 * the colour, the speed and the direction — and one canvas (`LinkDots`)
 * draws every stream in a single pass per frame.
 */

import { type Measured, measurePath } from '../../lib/pathMeasure';

export interface DotStream {
  /** The link's plain path, in diagram coordinates. */
  path: string;
  color: string;
  /** Seconds a dot takes end to end. */
  duration: number;
  forward: boolean;
  reverse: boolean;
}

/** A stream with its path cut into straight pieces, measured once. */
export type MeasuredStream = DotStream & Measured;

const streams = new Map<string, MeasuredStream>();
const listeners = new Set<() => void>();

function measure(stream: DotStream): MeasuredStream {
  return { ...stream, ...measurePath(stream.path) };
}

/** Registers a link's stream, or takes it away with `null`. */
export function setDots(id: string, stream: DotStream | null): void {
  const was = streams.get(id);
  if (!stream) {
    if (!was) return;
    streams.delete(id);
  } else {
    if (
      was && was.path === stream.path && was.color === stream.color && was.duration === stream.duration &&
      was.forward === stream.forward && was.reverse === stream.reverse
    ) return;
    streams.set(id, measure(stream));
  }
  for (const l of listeners) l();
}

export function dotStreams(): ReadonlyMap<string, MeasuredStream> {
  return streams;
}

export function subscribeDots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The point a fraction of the way along a measured stream, written into
 *  `out` (x, y) so a frame of a thousand dots allocates nothing; false when
 *  the stream has no length. */
export function pointAlong(s: MeasuredStream, fraction: number, out: { x: number; y: number }): boolean {
  if (s.total <= 0) return false;
  const want = fraction * s.total;
  const cum = s.cum;
  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! < want) lo = mid + 1;
    else hi = mid;
  }
  const span = cum[lo]! - cum[lo - 1]! || 1;
  const f = (want - cum[lo - 1]!) / span;
  const ax = s.pts[lo * 2 - 2]!;
  const ay = s.pts[lo * 2 - 1]!;
  out.x = ax + (s.pts[lo * 2]! - ax) * f;
  out.y = ay + (s.pts[lo * 2 + 1]! - ay) * f;
  return true;
}

/** Test seam: the register is module state. */
export function resetDots(): void {
  streams.clear();
}
