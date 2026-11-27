/**
 * Lasso selection: a freehand outline selects what it encloses.
 *
 * "Encloses" goes by an object's middle, the rule a section already uses for
 * what stands inside it: drawn round most of a box, the box is in.
 */
import type { TopoNode } from '../state/store';

export interface Point {
  x: number;
  y: number;
}

/** Even-odd ray casting; a point on an edge may land either side. */
export function insidePolygon(p: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The ids of the objects whose middles the outline encloses. An outline of
 *  fewer than three points encloses nothing. */
export function lassoed(nodes: readonly TopoNode[], outline: readonly Point[]): string[] {
  if (outline.length < 3) return [];
  return nodes
    .filter((n) => {
      const w = n.width ?? n.measured?.width ?? 76;
      const h = n.height ?? n.measured?.height ?? 76;
      return insidePolygon({ x: n.position.x + w / 2, y: n.position.y + h / 2 }, outline);
    })
    .map((n) => n.id);
}

/** Drops points closer than `step` to the last kept one, so a slow drag does
 *  not build an outline of thousands of points. */
export function addPoint(outline: Point[], p: Point, step = 4): Point[] {
  const last = outline[outline.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < step) return outline;
  return [...outline, p];
}

/** A link as a box or a lasso sees it: the points along its line, in the
 *  page's own coordinates. */
export interface LinkLine {
  id: string;
  points: readonly Point[];
}

/** Whether a point is in a box. */
export const insideBox = (box: { x: number; y: number; width: number; height: number }) => (p: Point) =>
  p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height;

/**
 * The links whose line passes through an area, in the order given.
 *
 * A link has no middle to go by the way a device has: it is caught where
 * any part of its line is inside, which is what drawing a box across a
 * bundle of links means. The line is walked between its points as well, a
 * few units at a time, so a small box between two of them still catches it.
 */
export function linksThrough(lines: readonly LinkLine[], inside: (p: Point) => boolean, step = 4): string[] {
  const caught: string[] = [];
  for (const line of lines) {
    let hit = line.points.some(inside);
    for (let i = 1; !hit && i < line.points.length; i++) {
      const a = line.points[i - 1]!;
      const b = line.points[i]!;
      const pieces = Math.min(400, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
      for (let k = 1; !hit && k < pieces; k++) hit = inside({ x: a.x + ((b.x - a.x) * k) / pieces, y: a.y + ((b.y - a.y) * k) / pieces });
    }
    if (hit) caught.push(line.id);
  }
  return caught;
}
