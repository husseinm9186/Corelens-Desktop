import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PAGE, effectivePage, pageForContent, sameRect, unionRect,
} from './pageRect';
import type { TopoNode } from '../state/store';

const at = (id: string, x: number, y: number, w = 168, h = 92): TopoNode =>
  ({ id, type: 'device', position: { x, y }, width: w, height: h,
     data: { label: id, deviceType: 'generic', tags: [], addresses: [],
       locked: false, maintenance: false, showDetails: true } }) as TopoNode;

describe('pageForContent', () => {
  it('is the default sheet for an empty diagram', () => {
    expect(pageForContent([])).toEqual(DEFAULT_PAGE);
  });

  it('is never smaller than the default sheet', () => {
    // Four devices in the middle do not deserve a postage stamp.
    expect(pageForContent([at('a', 400, 400)])).toEqual(DEFAULT_PAGE);
  });

  it('gives content near an edge its margin, even inside the default sheet', () => {
    // The margin is the rule: a device 100px from the top has less than the
    // 120px it is owed, so the sheet is no longer the one at the origin; it
    // is the default size, around the content.
    const r = pageForContent([at('a', 400, 100)]);
    expect(r.y).toBeLessThanOrEqual(-60);
    expect(r.h).toBe(DEFAULT_PAGE.h);
  });

  it('is drawn around the content, not around the origin', () => {
    // A diagram that sits well to the right of where the sheet started:
    // fitting the page to it must not keep the empty sheet on the left.
    const r = pageForContent([at('a', 2000, 400), at('b', 4000, 400)]);
    expect(r.x).toBe(1860); // 2000-120 = 1880, snapped down to 1860
    expect(r.x + r.w).toBe(4320); // 4000+168+120 = 4288, snapped up to 4320
    expect(r.h).toBe(DEFAULT_PAGE.h);
  });

  it('keeps the default size, centred on content smaller than the sheet', () => {
    const r = pageForContent([at('a', 2000, 400)]);
    expect(r.w).toBe(DEFAULT_PAGE.w);
    expect(r.h).toBe(DEFAULT_PAGE.h);
    // The device's centre (2084, 446) sits in the middle of the sheet, to
    // the nearest grid step.
    expect(Math.abs(r.x + r.w / 2 - 2084)).toBeLessThan(60);
    expect(Math.abs(r.y + r.h / 2 - 446)).toBeLessThan(60);
    expect(r.x % 60).toBe(0);
  });

  it('holds content at negative coordinates, margin included', () => {
    const r = pageForContent([at('a', -500, -300)]);
    // -500-120 = -620, snapped down to -660; -300-120=-420 -> -420 (already a
    // multiple of 60). Inside, with the sheet its default size.
    expect(r.x).toBeLessThanOrEqual(-660);
    expect(r.y).toBeLessThanOrEqual(-420);
    expect(r.w).toBe(DEFAULT_PAGE.w);
    expect(r.h).toBe(DEFAULT_PAGE.h);
  });

  it('snaps outward in whole grid steps, not pixel by pixel', () => {
    const a = pageForContent([at('a', 1584 - 168 + 1, 400)]);
    const b = pageForContent([at('a', 1584 - 168 + 4, 400)]);
    // Two positions inside the same step give the same page, and its
    // content-driven edge is on the grid (the default sheet's own width,
    // 11 inches, is not a multiple of a step and never was).
    expect(a).toEqual(b);
    expect(a.x % 60).toBe(0);
  });
});

describe('effectivePage', () => {
  it('never shrinks on its own', () => {
    // The page grew to hold something; deleting that something must not snap
    // the sheet smaller — that is the explicit fit-to-content action.
    const grown = { x: 0, y: 0, w: 3000, h: 1224 };
    expect(effectivePage(grown, [at('a', 400, 400)])).toEqual(grown);
  });

  it('grows past what was stored when content demands it', () => {
    const grown = { x: 0, y: 0, w: 3000, h: 1224 };
    const r = effectivePage(grown, [at('a', 400, 2000)]);
    expect(r.w).toBe(3000);
    expect(r.h).toBeGreaterThan(2000);
  });

  it('grows from where the sheet is, not back towards the origin', () => {
    // A sheet fitted around content on the right, then a device nudged past
    // its edge: the sheet grows a step, and the empty origin stays empty.
    const fitted = { x: 1860, y: 0, w: 2460, h: 1224 };
    const r = effectivePage(fitted, [at('a', 2000, 400), at('b', 4300, 400)]);
    expect(r.x).toBe(1860);
    expect(r.x + r.w).toBe(4620); // 4300+168+120 = 4588, snapped up
  });

  it('starts from the default when nothing is stored', () => {
    expect(effectivePage(undefined, [])).toEqual(DEFAULT_PAGE);
  });
});

describe('unionRect and sameRect', () => {
  it('unions across mixed origins', () => {
    expect(unionRect({ x: -60, y: 0, w: 100, h: 100 }, { x: 0, y: -60, w: 200, h: 100 }))
      .toEqual({ x: -60, y: -60, w: 260, h: 160 });
  });

  it('compares by value', () => {
    expect(sameRect(DEFAULT_PAGE, { ...DEFAULT_PAGE })).toBe(true);
    expect(sameRect(DEFAULT_PAGE, { ...DEFAULT_PAGE, w: 1 })).toBe(false);
  });
});
