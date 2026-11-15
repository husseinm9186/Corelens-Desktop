/**
 * What a device's label is drawn on, and the ink that reads on it.
 *
 * A label takes the canvas's ink and a halo in the canvas's colour, which is
 * right until the device stands on a filled box of some other colour: light
 * ink with a dark halo on a pale box reads as a smudge. A device standing on
 * a filled shape takes its ink from that shape's fill instead — dark on a
 * light fill, light on a dark one — with the halo in the fill's own colour.
 */
import { SHAPE_DEVICE_TYPES } from '../types/domain';

export interface LabelInk {
  ink: string;
  muted: string;
  halo: string;
}

// Near black, so that even a mid grey — the hardest fill there is — is read at 4.5:1.
const DARK = { ink: '#0d0f12', muted: '#2a2f36' };
const LIGHT = { ink: '#f2f5f8', muted: '#c3ccd8' };

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` and `rgba()`; anything else is not read. */
export function parseColour(text: string): { r: number; g: number; b: number; a: number } | null {
  const t = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const at = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) / 255 : 1 };
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(t)?.[1];
  if (fn) {
    const parts = fn.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    }
  }
  return null;
}

/** Relative luminance, 0 black to 1 white (WCAG). */
export function luminance(c: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** The ink for text on a fill; null when the fill is not a colour that covers what is under it. */
export function labelInkOn(fill: string | undefined): LabelInk | null {
  if (!fill) return null;
  const c = parseColour(fill);
  // A tint lets the canvas through, and the canvas's own ink still reads on it.
  if (!c || c.a < 0.6) return null;
  // Whichever of the two inks has the greater contrast with the fill.
  const l = luminance(c);
  const onDark = (luminance(parseColour(LIGHT.ink)!) + 0.05) / (l + 0.05);
  const onLight = (l + 0.05) / (luminance(parseColour(DARK.ink)!) + 0.05);
  return { ...(onLight >= onDark ? DARK : LIGHT), halo: fill };
}

interface Placed {
  id: string;
  type?: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  measured?: { width?: number; height?: number };
  data: unknown;
}

/**
 * For each device standing on a filled shape lower in the stack, that
 * shape's fill — the topmost one under the device's middle. `nodes` is in
 * stacking order, first at the back. A filled shape answers with its own
 * fill, which is what its own text is written on. Notes, unfilled shapes
 * and devices on the bare canvas are not in the answer.
 */
export function backdropFills(nodes: readonly Placed[]): Map<string, string> {
  const out = new Map<string, string>();
  const below: { x: number; y: number; w: number; h: number; fill: string }[] = [];
  for (const n of nodes) {
    if (n.type !== 'device') continue;
    const d = n.data as { deviceType?: string; style?: { background?: string } };
    const w = n.width ?? n.measured?.width ?? 0;
    const h = n.height ?? n.measured?.height ?? 0;
    if (d.deviceType && SHAPE_DEVICE_TYPES.has(d.deviceType)) {
      const fill = d.style?.background;
      if (d.deviceType !== 'zone' && d.deviceType !== 'text' && fill && labelInkOn(fill)) {
        below.push({ x: n.position.x, y: n.position.y, w, h, fill });
        // Its own text is written on its own fill.
        out.set(n.id, fill);
      }
      continue;
    }
    if (below.length === 0) continue;
    const cx = n.position.x + w / 2;
    const cy = n.position.y + h / 2;
    for (let i = below.length - 1; i >= 0; i--) {
      const s = below[i]!;
      if (cx >= s.x && cx <= s.x + s.w && cy >= s.y && cy <= s.y + s.h) {
        out.set(n.id, s.fill);
        break;
      }
    }
  }
  return out;
}

const filledCache = new WeakMap<readonly Placed[], { x: number; y: number; w: number; h: number; fill: string }[]>();

/** The filled shapes of a page, back to front; worked out once per node list. */
function filledShapes(nodes: readonly Placed[]) {
  let list = filledCache.get(nodes);
  if (!list) {
    list = [];
    for (const n of nodes) {
      if (n.type !== 'device') continue;
      const d = n.data as { deviceType?: string; style?: { background?: string } };
      const fill = d.style?.background;
      if (!d.deviceType || !SHAPE_DEVICE_TYPES.has(d.deviceType) || d.deviceType === 'zone' || d.deviceType === 'text') continue;
      if (!fill || !labelInkOn(fill)) continue;
      list.push({ x: n.position.x, y: n.position.y, w: n.width ?? n.measured?.width ?? 0, h: n.height ?? n.measured?.height ?? 0, fill });
    }
    filledCache.set(nodes, list);
  }
  return list;
}

/** The fill a label at this point is read against: the topmost filled shape there, if any. */
export function fillAt(nodes: readonly Placed[], x: number, y: number): string | undefined {
  const shapes = filledShapes(nodes);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return s.fill;
  }
  return undefined;
}

/** The ink for a fill as the custom properties the label styles read. */
export function labelInkVars(fill: string | undefined): Record<string, string> | undefined {
  const ink = labelInkOn(fill);
  return ink ? { '--label-ink': ink.ink, '--label-muted': ink.muted, '--label-halo': ink.halo } : undefined;
}
