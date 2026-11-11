import { describe, expect, it } from 'vitest';

import { fractionWhereYReaches, measurePath, nearestFraction, pointAtFraction, pointAtLength } from './pathMeasure';

describe('measuring a link path', () => {
  const elbow = 'M0,0L0,100L200,100';

  it('knows how long a path of straight runs is, and where a distance along it falls', () => {
    const m = measurePath(elbow);
    expect(m.total).toBe(300);
    expect(pointAtLength(m, 50)).toEqual({ x: 0, y: 50 });
    expect(pointAtLength(m, 150)).toEqual({ x: 50, y: 100 });
    // Past either end is the end.
    expect(pointAtLength(m, 999)).toEqual({ x: 200, y: 100 });
    expect(pointAtLength(m, -5)).toEqual({ x: 0, y: 0 });
  });

  it('follows a curve closely', () => {
    // A quarter circle of radius 100, as the usual cubic approximation.
    const k = 55.2285;
    const m = measurePath(`M100,0 C100,${k} ${k},100 0,100`);
    expect(m.total).toBeCloseTo((Math.PI * 100) / 2, 0);
    const mid = pointAtFraction(`M100,0 C100,${k} ${k},100 0,100`, 0.5)!;
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(100, 0);
  });

  it('rounds a corner the way the drawn path does', () => {
    // An 8-unit rounded corner is shorter than the square one it replaces.
    const m = measurePath('M0,0L0,92Q0,100 8,100L200,100');
    expect(m.total).toBeLessThan(300);
    expect(m.total).toBeGreaterThan(295);
  });

  it('finds the place on the path nearest a point', () => {
    expect(nearestFraction(elbow, -30, 50)).toBeCloseTo(50 / 300, 6);
    expect(nearestFraction(elbow, 100, 130)).toBeCloseTo(200 / 300, 6);
  });

  it('finds where a path first gets down to a height', () => {
    expect(fractionWhereYReaches(elbow, 60)).toBeCloseTo(60 / 300, 6);
    expect(fractionWhereYReaches(elbow, 500)).toBe(1);
  });

  it('has no answer for a path with no length', () => {
    expect(pointAtFraction('', 0.5)).toBeNull();
    expect(nearestFraction('M5,5', 0, 0)).toBeNull();
  });
});
