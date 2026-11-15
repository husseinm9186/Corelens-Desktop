import { describe, expect, it } from 'vitest';

import { IMPORT_COLUMNS, IMPORT_STEP_X, IMPORT_STEP_Y, placeBySite } from './importLayout';

describe('where imported devices are put down', () => {
  it('is the plain grid when no row names a site', () => {
    const { positions, blocks } = placeBySite(Array.from({ length: 8 }, () => ({})), { x: 80, y: 200 });
    expect(blocks).toEqual([]);
    expect(positions[0]).toEqual({ x: 80, y: 200 });
    expect(positions[IMPORT_COLUMNS - 1]).toEqual({ x: 80 + (IMPORT_COLUMNS - 1) * IMPORT_STEP_X, y: 200 });
    expect(positions[IMPORT_COLUMNS]).toEqual({ x: 80, y: 200 + IMPORT_STEP_Y });
  });

  it('keeps each site in a block of its own, in the order the sheet names them', () => {
    const rows = [{ site: 'B' }, { site: 'A' }, { site: 'B' }, { site: 'A' }, { site: ' B ' }];
    const { positions, blocks } = placeBySite(rows, { x: 0, y: 0 });
    expect(blocks).toEqual([{ site: 'B', indexes: [0, 2, 4] }, { site: 'A', indexes: [1, 3] }]);
    // B's three side by side on one row; A's two on a row well below it.
    expect(new Set([0, 2, 4].map((i) => positions[i]!.y)).size).toBe(1);
    expect(positions[1]!.y).toBe(positions[3]!.y);
    expect(positions[1]!.y - positions[0]!.y).toBeGreaterThan(IMPORT_STEP_Y);
    expect([positions[0]!.x, positions[2]!.x, positions[4]!.x]).toEqual([0, IMPORT_STEP_X, 2 * IMPORT_STEP_X]);
  });

  it('never puts two devices in one place', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ site: i % 3 ? `S${i % 3}` : undefined }));
    const { positions } = placeBySite(rows, { x: 0, y: 0 });
    expect(new Set(positions.map((p) => `${p.x},${p.y}`)).size).toBe(40);
  });
});
