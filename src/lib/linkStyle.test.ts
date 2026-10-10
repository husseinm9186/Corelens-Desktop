import { describe, expect, it } from 'vitest';

import { capPath, capsFor, dashFor, doubleWidths, kindOf, stepAlong, strokeFor } from './linkStyle';

describe('dashFor', () => {
  it('keeps the health meaning when nothing has been chosen', () => {
    // Every diagram drawn before the choice existed must look the same.
    expect(dashFor(undefined, 'down')).toBe('10 6');
    expect(dashFor(undefined, 'healthy')).toBeUndefined();
    expect(dashFor('auto', 'disabled')).toBe('2 6');
  });

  it('lets a chosen style win over the health meaning', () => {
    // A dashed line means a tunnel here, and a healthy tunnel is still a
    // tunnel.
    expect(dashFor('dashed', 'healthy')).toBe('10 6');
    expect(dashFor('solid', 'down')).toBeUndefined();
  });

  it('has a distinct pattern for each style', () => {
    const seen = new Set(
      (['solid', 'dashed', 'dotted', 'dash-dot'] as const).map((s) => String(dashFor(s, 'healthy'))),
    );
    expect(seen.size).toBe(4);
  });
});

describe('capsFor', () => {
  it('follows the flow direction when nothing is chosen', () => {
    expect(capsFor({ direction: 'forward' })).toEqual({ start: 'none', end: 'arrow' });
    expect(capsFor({ direction: 'reverse' })).toEqual({ start: 'arrow', end: 'none' });
    expect(capsFor({ direction: 'both' })).toEqual({ start: 'arrow', end: 'arrow' });
    expect(capsFor({ direction: 'none' })).toEqual({ start: 'none', end: 'none' });
  });

  it('lets an explicit cap win', () => {
    expect(capsFor({ direction: 'forward', endCap: 'circle' }).end).toBe('circle');
    expect(capsFor({ direction: 'none', startCap: 'diamond' }).start).toBe('diamond');
  });

  it('honours an explicit none on a link the direction would have arrowed', () => {
    // Otherwise there is no way to take the arrow off one end of a link that
    // still carries a direction for the animation.
    expect(capsFor({ direction: 'both', endCap: 'none' }).end).toBe('none');
  });

  it('treats a link with no direction at all as forward, as it always did', () => {
    expect(capsFor({})).toEqual({ start: 'none', end: 'arrow' });
  });
});

describe('capPath', () => {
  it('draws nothing for none', () => {
    expect(capPath('none')).toBeNull();
  });

  it('has geometry for every cap that is not none', () => {
    for (const cap of ['arrow', 'open-arrow', 'circle', 'square', 'diamond'] as const) {
      const p = capPath(cap);
      expect(p, cap).not.toBeNull();
      expect(p!.d.length).toBeGreaterThan(6);
    }
  });

  it('leaves the open arrow unfilled, which is what makes it open', () => {
    expect(capPath('open-arrow')!.filled).toBe(false);
    expect(capPath('arrow')!.filled).toBe(true);
  });
});

describe('kindOf', () => {
  it('reads what a crawl knows about a link', () => {
    expect(kindOf({ overlay: true })).toBe('tunnel');
    expect(kindOf({ layer3: true })).toBe('logical');
    expect(kindOf({ notes: 'Discovered: Po1 \u2194 Po1 \u2014 2 bundled ports: Gi1/0/1, Gi1/0/2' })).toBe('bundle');
    expect(kindOf({ cableType: 'wan' })).toBe('transit');
    expect(kindOf({})).toBe('cable');
    expect(kindOf({ cableType: 'fiber-sm' })).toBe('cable');
  });

  it('lets a choice on the link win, and auto fall back to what is known', () => {
    expect(kindOf({ overlay: true, linkKind: 'cable' })).toBe('cable');
    expect(kindOf({ linkKind: 'bundle' })).toBe('bundle');
    expect(kindOf({ overlay: true, linkKind: 'auto' })).toBe('tunnel');
  });
});

describe('strokeFor', () => {
  it('dashes a tunnel and dots a logical link whatever their health', () => {
    expect(strokeFor({ overlay: true }, 'healthy').dash).toBe('6 4');
    expect(strokeFor({ overlay: true }, 'warning').dash).toBe('6 4');
    expect(strokeFor({ layer3: true }, 'healthy').dash).toBe('1.5 3');
    // The default style is solid, and solid does not hide what the link is.
    expect(strokeFor({ overlay: true, lineStyle: 'solid' }, 'healthy').dash).toBe('6 4');
  });

  it('keeps the health pattern on a cable, a bundle and a transit circuit', () => {
    expect(strokeFor({}, 'down').dash).toBe('10 6');
    expect(strokeFor({ linkKind: 'bundle' }, 'down').dash).toBe('10 6');
    expect(strokeFor({ cableType: 'wan' }, 'warning').dash).toBe('2 4');
    expect(strokeFor({}, 'healthy').dash).toBeUndefined();
  });

  it('lets a chosen pattern win over the kind', () => {
    expect(strokeFor({ overlay: true, lineStyle: 'dotted' }, 'healthy').dash).toBe('2 5');
  });

  it('doubles a bundle and makes a transit circuit heavier', () => {
    expect(strokeFor({ linkKind: 'bundle' }, 'healthy').double).toBe(true);
    expect(strokeFor({}, 'healthy').double).toBe(false);
    expect(strokeFor({ cableType: 'wan', width: 2 }, 'healthy').width).toBeGreaterThan(2);
    expect(strokeFor({ width: 3 }, 'healthy').width).toBe(3);
  });

  it('draws a double line as two strokes with a gap between them', () => {
    const { outer, gap } = doubleWidths(2);
    // Each of the two strokes left either side of the gap is visible.
    expect((outer - gap) / 2).toBeGreaterThan(1);
    expect(gap).toBeGreaterThan(1.5);
  });
});


describe('arrows on a traced path', () => {
  it('points a link the way the path runs along it', () => {
    expect(stepAlong(['a', 'b', 'c'], 'a', 'b')).toBe(1);
    expect(stepAlong(['a', 'b', 'c'], 'c', 'b')).toBe(-1);
    // Not a step: both on the path but not next to each other, or one off it.
    expect(stepAlong(['a', 'b', 'c'], 'a', 'c')).toBe(0);
    expect(stepAlong(['a', 'b'], 'a', 'x')).toBe(0);
    expect(stepAlong(null, 'a', 'b')).toBe(0);
  });

  it('adds the arrow to an undirected link, and leaves a chosen end alone', () => {
    expect(capsFor({ direction: 'none' }, 1)).toEqual({ start: 'none', end: 'arrow' });
    expect(capsFor({ direction: 'none' }, -1)).toEqual({ start: 'arrow', end: 'none' });
    expect(capsFor({ direction: 'none', endCap: 'circle' }, 1).end).toBe('circle');
    expect(capsFor({ direction: 'none' }, 0)).toEqual({ start: 'none', end: 'none' });
  });
});
