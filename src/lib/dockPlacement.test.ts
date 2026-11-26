import { describe, expect, it } from 'vitest';

import { autoUiScale, DEFAULT_DOCK_SIDE, dockSideFor, dockWidthClass, fitColumns, stepUiScale } from './dockPlacement';

describe('dockSideFor', () => {
  it('opens discovering devices and the terminal down the right', () => {
    expect(dockSideFor('crawl', {})).toBe('right');
    expect(dockSideFor('discover', {})).toBe('right');
    expect(dockSideFor('ssh', {})).toBe('right');
  });

  it('keeps the wide tables along the bottom', () => {
    for (const tab of ['objects', 'events', 'trace', 'path', 'tracert', 'whereis', 'backup'] as const) {
      expect(dockSideFor(tab, {})).toBe('bottom');
    }
  });

  it('lets an override win, per tab', () => {
    expect(dockSideFor('crawl', { crawl: 'bottom' })).toBe('bottom');
    expect(dockSideFor('objects', { objects: 'right' })).toBe('right');
    // An override on one tab does not move another.
    expect(dockSideFor('ssh', { crawl: 'bottom' })).toBe('right');
  });
});

describe('dockWidthClass', () => {
  it('gives the terminal half the window and discovery a narrow column', () => {
    expect(dockWidthClass('ssh')).toBe('is-dock-wide');
    expect(dockWidthClass('crawl')).toBe('is-dock-narrow');
    expect(dockWidthClass('discover')).toBe('is-dock-narrow');
  });

  it('keeps an empty terminal tab narrow until a session opens', () => {
    expect(dockWidthClass('ssh', false)).toBe('is-dock-narrow');
    expect(dockWidthClass('console', false)).toBe('is-dock-narrow');
    expect(dockWidthClass('console', true)).toBe('is-dock-wide');
  });
});

describe('the defaults', () => {
  it('names only the four that open on the right', () => {
    expect(Object.keys(DEFAULT_DOCK_SIDE).sort()).toEqual(['console', 'crawl', 'discover', 'ssh']);
  });
});

describe('fitColumns', () => {
  const base = { paletteOpen: true, inspectorOpen: true, selection: false };
  // 1 rem = 13 px; the body is the window less the 64 px rail.
  const at = (vw: number, over: Partial<Parameters<typeof fitColumns>[0]> = {}) =>
    fitColumns({ ...base, vw, body: vw - 64, rem: 13, dock: 'wide', ...over });

  it('keeps every column on a big screen, and the diagram a floor', () => {
    const f = at(1920);
    expect(f).toMatchObject({ palette: true, inspector: true, dockBelow: false });
    expect(f.mainMin).toBeGreaterThanOrEqual(0.25 * (1920 - 64));
  });

  it('folds the shape list first, then the inspector when nothing is selected', () => {
    expect(at(1200)).toMatchObject({ palette: false, inspector: true, dockBelow: false });
    expect(at(1100)).toMatchObject({ palette: false, inspector: false, dockBelow: false });
  });

  it('never folds what is needed: a selection keeps its inspector and the dock goes below', () => {
    expect(at(1000, { selection: true })).toMatchObject({ inspector: true, dockBelow: true });
  });

  it('keeps a column brought back by hand, and never unfolds one folded by hand', () => {
    expect(at(1200, { keepPalette: true }).palette).toBe(true);
    expect(at(1920, { paletteOpen: false }).palette).toBe(false);
  });

  it('puts nothing beside the diagram in a very narrow window', () => {
    expect(at(800).dockBelow).toBe(true);
  });
});

describe('the interface size', () => {
  it('follows the window when automatic', () => {
    expect(autoUiScale(1000)).toBeLessThan(1);
    expect(autoUiScale(1440)).toBe(1);
    expect(autoUiScale(2560)).toBeGreaterThan(1);
  });

  it('steps by tenths between 50 % and 200 %', () => {
    expect(stepUiScale(1, 1)).toBe(1.1);
    expect(stepUiScale(0.85, -1)).toBe(0.8);
    expect(stepUiScale(0.5, -1)).toBe(0.5);
    expect(stepUiScale(2, 1)).toBe(2);
  });
});
