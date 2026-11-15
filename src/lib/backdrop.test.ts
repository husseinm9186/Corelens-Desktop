import { describe, expect, it } from 'vitest';

import { backdropFills, fillAt, labelInkOn, labelInkVars, luminance, parseColour } from './backdrop';

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(parseColour(a)!), luminance(parseColour(b)!)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('label ink on a fill', () => {
  it('reads colours as hex and rgb()', () => {
    expect(parseColour('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColour('#10203080')?.a).toBeCloseTo(0.5, 1);
    expect(parseColour('rgba(10, 20, 30, 0.4)')).toEqual({ r: 10, g: 20, b: 30, a: 0.4 });
    expect(parseColour('papayawhip')).toBeNull();
  });

  it('gives dark ink on a light fill and light ink on a dark one, each readable', () => {
    for (const fill of ['#ebebeb', '#ffffff', '#ffd966', '#7fd1e0', '#101820', '#7a1f1f', '#2d5fa8', '#808080']) {
      const ink = labelInkOn(fill)!;
      expect(ink.halo).toBe(fill);
      expect(contrast(ink.ink, fill), fill).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink.muted, fill), fill).toBeGreaterThanOrEqual(3);
    }
    expect(labelInkOn('#ebebeb')!.ink).toBe('#0d0f12');
    expect(labelInkOn('#101820')!.ink).toBe('#f2f5f8');
  });

  it('leaves a tint, an unreadable value and no fill to the canvas ink', () => {
    expect(labelInkOn('rgba(255,255,255,0.2)')).toBeNull();
    expect(labelInkOn('none')).toBeNull();
    expect(labelInkOn(undefined)).toBeNull();
  });
});

describe('what a device stands on', () => {
  const shape = (id: string, x: number, y: number, w: number, h: number, background?: string, deviceType = 'rounded') => ({
    id, type: 'device', position: { x, y }, width: w, height: h, data: { deviceType, style: background ? { background } : undefined },
  });
  const dev = (id: string, x: number, y: number) => ({ id, type: 'device', position: { x, y }, width: 100, height: 100, data: { deviceType: 'router' } });

  it('is the topmost filled shape under its middle that is lower in the stack', () => {
    const fills = backdropFills([
      shape('big', 0, 0, 1000, 1000, '#eeeeee'),
      shape('small', 0, 0, 300, 300, '#112233'),
      dev('on-small', 50, 50),
      dev('on-big', 600, 600),
      dev('outside', 2000, 2000),
      shape('above', 0, 0, 1000, 1000, '#ff0000'),
    ]);
    expect(fills.get('on-small')).toBe('#112233');
    expect(fills.get('on-big')).toBe('#eeeeee');
    expect(fills.has('outside')).toBe(false);
    // A filled shape's own text is read against its own fill.
    expect(fills.get('big')).toBe('#eeeeee');
    expect(fills.get('above')).toBe('#ff0000');
  });

  it('does not count an unfilled shape, a tinted one or a zone', () => {
    const fills = backdropFills([
      shape('outline', 0, 0, 500, 500),
      shape('tint', 0, 0, 500, 500, 'rgba(0,0,0,0.1)'),
      shape('zone', 0, 0, 500, 500, '#ffffff', 'zone'),
      dev('d', 100, 100),
    ]);
    expect(fills.size).toBe(0);
  });

  it('answers for a point too, which is where a link label is', () => {
    const nodes = [shape('big', 0, 0, 1000, 1000, '#eeeeee'), dev('d', 10, 10), shape('top', 0, 0, 100, 100, '#101010')];
    expect(fillAt(nodes, 500, 500)).toBe('#eeeeee');
    expect(fillAt(nodes, 50, 50)).toBe('#101010');
    expect(fillAt(nodes, 5000, 5000)).toBeUndefined();
    expect(labelInkVars('#eeeeee')).toEqual({ '--label-ink': '#0d0f12', '--label-muted': '#2a2f36', '--label-halo': '#eeeeee' });
    expect(labelInkVars(undefined)).toBeUndefined();
  });
});
