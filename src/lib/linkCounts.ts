/**
 * How many links each device on a page has.
 *
 * Past three, a device's port chips crowd round it and stop being readable:
 * they are shown when the link or the device is pointed at or selected, or
 * close up, and the device says how many links it has instead. Counted once
 * per edge list, not once per link asking.
 */
import type { LinkData } from '../types/domain';

type EdgeEnds = { source: string; target: string; data?: unknown };

/** More links than this and a device's port chips wait to be asked for. */
export const CROWDED_LINKS = 3;

/** Above this zoom every port chip shows: there is room for them. */
export const CLOSE_ZOOM = 1.2;

const cache = new WeakMap<readonly EdgeEnds[], Map<string, number>>();

export function linkCountsOf(edges: readonly EdgeEnds[]): Map<string, number> {
  const hit = cache.get(edges);
  if (hit) return hit;
  const out = new Map<string, number>();
  for (const e of edges) {
    // A leader points a note at something; it is not a link.
    if ((e.data as LinkData | undefined)?.kind === 'leader') continue;
    out.set(e.source, (out.get(e.source) ?? 0) + 1);
    if (e.target !== e.source) out.set(e.target, (out.get(e.target) ?? 0) + 1);
  }
  cache.set(edges, out);
  return out;
}
