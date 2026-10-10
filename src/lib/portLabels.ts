/**
 * Where a port label sits on its link.
 *
 * Beside the line, not on it, a fixed distance from the end it belongs to —
 * how ports are labelled on a drawn diagram — and past the device's own
 * name when the link leaves downward through it: on a tiered diagram a
 * glyph's name hangs below it, straight across the path of every link to
 * the tier beneath, and a label a third of the way along landed on top of
 * it. Parallel cables out of one end are ranked and each rank goes a
 * chip-length further along, so two chips never share a spot.
 * Shared by the canvas and the export so both place them the same.
 */

export interface ChipInput {
  /** The link's drawn length. */
  len: number;
  /** This link's rank among those leaving the same point, 0 first. */
  rank: number;
  /** The end's y and the unit direction the path leaves it in. */
  endY: number;
  dirY: number;
  /** Where the device's name block ends below the end, or null when the
   *  device has none in the way (a card, a shape, a link leaving sideways). */
  nameBottom: number | null;
  /** The centre label's width, 0 when there is none. */
  centreW: number;
  /** This chip's own width. */
  chipW: number;
}

export interface ChipPlace {
  /** Distance along the path from this end. */
  along: number;
  /** Perpendicular offset of the chip's centre from the line. */
  off: number;
}

/** A glyph's name block height, in flow units, from what it shows: the name,
 *  then the address and the status when details are on, and a maintenance
 *  line. The canvas sets them at 12 and 10 px with line-height 1.35. */
export function nameBlockHeight(d: { showDetails?: boolean; maintenance?: boolean; addresses?: readonly { address?: string }[]; label?: string }): number {
  let h = 6 + 16; // the gap under the glyph, then the name line
  if (d.showDetails) {
    if (d.addresses?.some((a) => a.address && a.address !== d.label)) h += 14;
    h += 14; // the status line
    if (d.maintenance) h += 14;
  }
  return h;
}

/** A chip's width from its text: the mono face at 10 px, plus the padding. */
export function chipWidthOf(text: string): number {
  return text.length * 6.4 + 12;
}

export function placePortChip(c: ChipInput): ChipPlace {
  // A chip-length per rank, or neighbouring chips still overlap; capped so a
  // short link's chip stays on its own half.
  let along = Math.min(46 + c.rank * 66, c.len * (0.4 - 0.08 * Math.min(c.rank, 3)));
  // Leaving downward through the name: past it, with a little air, but never
  // beyond the middle, where it would be the other end's.
  if (c.nameBottom !== null && c.dirY > 0.5) {
    const clear = (c.nameBottom + 8 - c.endY) / c.dirY;
    along = Math.max(along, Math.min(clear, c.len * 0.5));
  }
  let off = c.chipW / 2 + 6;
  // Level with the centre label, step outside it rather than under it.
  if (c.centreW > 0 && Math.abs(along - c.len / 2) < 14) off = c.centreW / 2 + c.chipW / 2 + 6;
  return { along, off };
}

/**
 * Where the centre label goes when nothing has moved it: the middle, unless
 * the middle of a short link down from a glyph is inside that glyph's name
 * block — two tiers a hand apart put the cable tag straight over the name
 * above it. Then it slides down past the name, never beyond three quarters,
 * where it would be the other end's business. A fraction of the length.
 */
export function centreLabelFraction(c: { len: number; endY: number; dirY: number; nameBottom: number | null }): number {
  if (c.nameBottom === null || c.dirY <= 0.5 || c.len <= 0) return 0.5;
  const clear = (c.nameBottom + 10 - c.endY) / c.dirY;
  const f = clear / c.len;
  return f > 0.5 ? Math.min(0.75, f) : 0.5;
}

/** A placed chip, for pushing apart. `ux`/`uy` is the way along its link
 *  away from its own device: the one direction it may move without leaving
 *  the line it labels. */
export interface ChipBox {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  ux: number;
  uy: number;
  /** Put there by hand: it stays, and the others move round it. */
  fixed?: boolean;
}

/** How far a chip may be pushed, and in what steps. */
const PUSH_STEP = 6;
const PUSH_STEPS = 16;
const CHIP_GAP = 2;
const CELL = 96;

/**
 * Pushes overlapping port chips apart, in one greedy pass.
 *
 * Ranking parallel cables keeps the chips of links leaving the same point
 * apart, but two links leaving one device from neighbouring ports, or a
 * chip of one device reaching the chip of the next, still landed on each
 * other. Each chip in turn — the ones placed by hand first, then by key, so
 * every link works out the same answer — is slid along its own link, away
 * from its device, until it clears the chips already placed. Bounded: a chip
 * that cannot be cleared within a short distance stays at the last place
 * tried rather than wandering off to the far end.
 */
export function pushChips(chips: readonly ChipBox[]): Map<string, { x: number; y: number }> {
  const order = [...chips].sort((a, b) => (a.fixed === b.fixed ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.fixed ? -1 : 1));
  const grid = new Map<string, { x: number; y: number; w: number; h: number }[]>();
  const cellsOf = (x: number, y: number, w: number, h: number) => {
    const out: string[] = [];
    for (let cx = Math.floor((x - w / 2) / CELL); cx <= Math.floor((x + w / 2) / CELL); cx += 1) {
      for (let cy = Math.floor((y - h / 2) / CELL); cy <= Math.floor((y + h / 2) / CELL); cy += 1) out.push(`${cx},${cy}`);
    }
    return out;
  };
  const hits = (x: number, y: number, w: number, h: number) => {
    for (const cell of cellsOf(x, y, w, h)) {
      for (const o of grid.get(cell) ?? []) {
        if (Math.abs(o.x - x) * 2 < o.w + w + CHIP_GAP * 2 && Math.abs(o.y - y) * 2 < o.h + h + CHIP_GAP * 2) return true;
      }
    }
    return false;
  };
  const out = new Map<string, { x: number; y: number }>();
  for (const c of order) {
    let { x, y } = c;
    if (!c.fixed) {
      for (let i = 0; i < PUSH_STEPS && hits(x, y, c.w, c.h); i += 1) {
        x += c.ux * PUSH_STEP;
        y += c.uy * PUSH_STEP;
      }
    }
    const placed = { x, y, w: c.w, h: c.h };
    for (const cell of cellsOf(x, y, c.w, c.h)) {
      const list = grid.get(cell);
      if (list) list.push(placed);
      else grid.set(cell, [placed]);
    }
    out.set(c.key, { x, y });
  }
  return out;
}
