/**
 * Where the page is and how big it is.
 *
 * The page grows to hold whatever is drawn on it — a device dragged past the
 * edge is not sitting on the desk, it is on a bigger sheet. It never shrinks
 * on its own, because a sheet that snaps smaller mid-drag makes the whole
 * layout jump; shrinking is the explicit "Fit page to content" action.
 *
 * This is the one place the rect is computed. The renderer, Fit view, the
 * grid and any export that uses page bounds all call in here — three copies
 * of this arithmetic would disagree within a week.
 */
import type { TopoNode } from '../state/store';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 11 by 8.5 inches at 144 dpi, landscape. The sheet a new project gets. */
export const DEFAULT_PAGE: Rect = { x: 0, y: 0, w: 1584, h: 1224 };

/** How far content sits from the paper's edge. */
export const PAGE_MARGIN = 120;

/** The page resizes in whole major-grid steps, so it does not creep
 *  pixel-by-pixel under a drag. */
const SNAP = 60;

const down = (v: number) => Math.floor(v / SNAP) * SNAP;
const up = (v: number) => Math.ceil(v / SNAP) * SNAP;

/** The content's bounds with the margin, snapped outward to the grid;
 *  none when there is no content. */
function contentRect(nodes: TopoNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const w = n.width ?? n.measured?.width ?? 168;
    const h = n.height ?? n.measured?.height ?? 92;
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
    maxX = Math.max(maxX, n.position.x + w);
    maxY = Math.max(maxY, n.position.y + h);
  }
  const x = down(minX - PAGE_MARGIN);
  const y = down(minY - PAGE_MARGIN);
  return { x, y, w: up(maxX + PAGE_MARGIN) - x, h: up(maxY + PAGE_MARGIN) - y };
}

const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y
  && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * The smallest page that holds these nodes, with the margin, snapped outward
 * to the major grid, and never smaller than the default sheet.
 *
 * The page is drawn around the content, not around the origin: a diagram
 * that has drifted to the right of where the sheet started gets a sheet
 * that starts where it does, not one that keeps an empty half on the
 * left. Content smaller than the default sheet gets that sheet centred on
 * it — unless it already sits inside the default sheet at the origin, which
 * is then left where it is, so a small diagram does not move its paper.
 *
 * Callers pass the nodes of the *current view* — a device on a hidden view
 * should not be holding the page open.
 */
export function pageForContent(nodes: TopoNode[]): Rect {
  const c = contentRect(nodes);
  if (!c || contains(DEFAULT_PAGE, c)) return DEFAULT_PAGE;
  const w = Math.max(c.w, DEFAULT_PAGE.w);
  const h = Math.max(c.h, DEFAULT_PAGE.h);
  return {
    x: down(c.x - (w - c.w) / 2),
    y: down(c.y - (h - c.h) / 2),
    w,
    h,
  };
}

/** The union of two rects — how the page grows without ever shrinking. */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/**
 * The page as it should be drawn right now: whatever it has grown to, grown
 * further if the content demands it, and never shrunk here.
 */
export function effectivePage(stored: Rect | undefined, visibleNodes: TopoNode[]): Rect {
  const page = stored ?? DEFAULT_PAGE;
  const c = contentRect(visibleNodes);
  return c ? unionRect(page, c) : page;
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
