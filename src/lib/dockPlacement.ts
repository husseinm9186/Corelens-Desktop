/**
 * Which side of the window the dock sits on, per tab.
 *
 * Most of what the dock holds is a wide table — the monitored objects, the
 * paths, the backups — and wants the width of the window along the bottom.
 * Two things do not: discovering devices and the terminal are tall, narrow
 * work, and belong down the right beside the diagram, where their steps and
 * their session read top to bottom. So the side follows the tab, with a
 * default per tab and an override the operator can set and that is
 * remembered for this machine.
 *
 * It never replaces the inspector: the right dock is a column of its own,
 * and a crawl's live table still selects into the inspector beside it.
 */
import type { DockTab } from '../state/store';

export type DockSide = 'bottom' | 'right';

/** The side a tab opens on before anyone moves it. Discovering devices and
 *  the terminal start down the right; everything else along the bottom. */
export const DEFAULT_DOCK_SIDE: Partial<Record<DockTab, DockSide>> = {
  crawl: 'right',
  discover: 'right',
  ssh: 'right',
  console: 'right',
};

export function dockSideFor(tab: DockTab, overrides: Partial<Record<DockTab, DockSide>>): DockSide {
  return overrides[tab] ?? DEFAULT_DOCK_SIDE[tab] ?? 'bottom';
}

/**
 * The width class for the right dock. The terminal wants half the window —
 * a wrapped command line is unreadable — while discovering devices is a
 * column of form steps that reads at a narrower width.
 */
export function dockWidthClass(tab: DockTab, hasSession = true): 'is-dock-wide' | 'is-dock-narrow' {
  // An empty terminal tab says only how to open a session, and takes no
  // more room than discovery's form until one is open.
  return (tab === 'ssh' || tab === 'console') && hasSession ? 'is-dock-wide' : 'is-dock-narrow';
}

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** What the layout leaves the diagram, worked out before it is drawn. */
export interface ColumnFit {
  palette: boolean;
  inspector: boolean;
  /** The right dock does not fit beside a usable diagram: it goes below. */
  dockBelow: boolean;
  /** The least the diagram's columns may be given, px: the diagram's floor
   *  and the side columns shown. The dock narrows, to its own minimum, to
   *  leave this. */
  mainMin: number;
}

/**
 * Which columns fit beside the diagram while the dock is down the right.
 *
 * Every column there has a floor of its own — the shape list, the inspector,
 * the terminal — and the diagram, as `minmax(0, 1fr)`, used to be the one
 * that gave way: in a laptop-sized window it came down to a sliver. Here the
 * diagram has a floor too and the others make room in turn: the shape list
 * folds, then the inspector unless something is selected, and if the diagram
 * still has no room the dock goes below. Folding is never written back, so
 * what was folded by hand stays folded and the rest unfolds when the window
 * grows. The widths mirror the stylesheet's rules for these columns.
 */
export function fitColumns(o: {
  /** Width of the body that holds the diagram's columns and the dock, px. */
  body: number;
  /** The window's width, px, which the clamps' middle terms follow. */
  vw: number;
  /** The root font size, px. */
  rem: number;
  dock: 'narrow' | 'wide';
  selection: boolean;
  paletteOpen: boolean;
  inspectorOpen: boolean;
  /** Brought back by hand after being folded for room: not folded again. */
  keepPalette?: boolean;
  keepInspector?: boolean;
}): ColumnFit {
  const { vw, rem: r } = o;
  // The stylesheet's narrow-window rules: under 1080 px the inspector shows
  // only for a selection and then the palette gives way to it; under 820 px
  // nothing sits beside the diagram, so neither does the dock.
  if (vw <= 820) return { palette: false, inspector: o.inspectorOpen && o.selection, dockBelow: true, mainMin: 0 };
  let palette = o.paletteOpen && !(vw <= 1080 && o.selection);
  let inspector = o.inspectorOpen && (vw > 1080 || o.selection);
  const P = clamp(11.53846154 * r, 0.15 * vw, 16.76923077 * r);
  const I = clamp(18.46153846 * r, 0.22 * vw, 26.15384615 * r);
  // The dock narrows before anything folds, but a terminal not below two
  // fifths of the window (about 80 columns), and the form to its minimum.
  const D = o.dock === 'wide' ? Math.max(33.84615385 * r, 0.4 * vw) : 27.69230769 * r;
  const floor = Math.max(30 * r, 0.25 * o.body);
  const left = () => o.body - D - (palette ? P : 0) - (inspector ? I : 0);
  if (left() < floor && !o.keepPalette) palette = false;
  if (left() < floor && !o.selection && !o.keepInspector) inspector = false;
  if (left() < floor) return { palette: o.paletteOpen && !(vw <= 1080 && o.selection), inspector: o.inspectorOpen && (vw > 1080 || o.selection), dockBelow: true, mainMin: 0 };
  return { palette, inspector, dockBelow: false, mainMin: Math.floor(floor + (palette ? P : 0) + (inspector ? I : 0)) };
}

/** The interface's size when it follows the window: smaller on a laptop,
 *  its own on an ordinary monitor, a little larger on a big one. */
export function autoUiScale(vw: number): number {
  if (vw < 1150) return 0.85;
  if (vw < 1300) return 0.92;
  if (vw < 2000) return 1;
  if (vw < 2600) return 1.08;
  return 1.15;
}

/** A step of Ctrl+Shift + or −, kept between 50 % and 200 %. */
export function stepUiScale(from: number, dir: 1 | -1): number {
  return Math.round(clamp(5, Math.round(from * 10) + dir, 20)) / 10;
}

/** Reads the remembered overrides. Window state, like the panels' own. */
export function readDockPlacements(): Partial<Record<DockTab, DockSide>> {
  try {
    const raw = JSON.parse(localStorage.getItem('corelens.view.dockPlacements') ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out: Partial<Record<DockTab, DockSide>> = {};
    for (const [k, v] of Object.entries(raw)) if (v === 'bottom' || v === 'right') out[k as DockTab] = v;
    return out;
  } catch {
    return {};
  }
}
