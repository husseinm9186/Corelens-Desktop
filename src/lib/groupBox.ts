/**
 * A box drawn round a set of objects, in one step.
 *
 * Drawing a rectangle, dragging it to size over the devices it is meant to
 * frame and sending it to the back is three steps and the last is the one
 * that gets forgotten. This works out the frame from the objects themselves
 * and says where in the stack it goes: first, which is the back.
 */

export interface Placed {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  measured?: { width?: number; height?: number };
}

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room left round the objects, and the extra under them: a device's name
 *  and address are written below its glyph, outside the node's own box. */
export const BOX_MARGIN = 36;
export const BOX_LABEL_ROOM = 48;

/**
 * The frame round the chosen objects, on the grid, or null when none of
 * them is on the page. `fallback` is the size of an object that has not
 * been measured yet — one added a moment ago.
 */
export function frameAround(
  nodes: readonly Placed[],
  ids: ReadonlySet<string>,
  options: { grid?: number; fallback?: { width: number; height: number }; top?: number } = {},
): Frame | null {
  const grid = options.grid ?? 12;
  const fallback = options.fallback ?? { width: 96, height: 72 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    if (!ids.has(n.id)) continue;
    const w = n.width ?? n.measured?.width ?? fallback.width;
    const h = n.height ?? n.measured?.height ?? fallback.height;
    x0 = Math.min(x0, n.position.x);
    y0 = Math.min(y0, n.position.y);
    x1 = Math.max(x1, n.position.x + w);
    y1 = Math.max(y1, n.position.y + h);
  }
  if (!Number.isFinite(x0)) return null;
  const down = (v: number) => Math.floor(v / grid) * grid;
  const up = (v: number) => Math.ceil(v / grid) * grid;
  const x = down(x0 - BOX_MARGIN);
  const y = down(y0 - BOX_MARGIN - (options.top ?? 0));
  return { x, y, width: up(x1 + BOX_MARGIN) - x, height: up(y1 + BOX_MARGIN + BOX_LABEL_ROOM) - y };
}

/** The page's objects with the box under all of them. */
export function withBoxAtBack<T>(nodes: readonly T[], box: T): T[] {
  return [box, ...nodes];
}
