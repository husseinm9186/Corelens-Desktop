import { describe, expect, it } from 'vitest';

import { nextRow } from './rowKeys';

describe('nextRow', () => {
  it('moves a row at a time and stops at the ends', () => {
    expect(nextRow(5, 2, 'ArrowDown')).toBe(3);
    expect(nextRow(5, 4, 'ArrowDown')).toBe(4);
    expect(nextRow(5, 2, 'ArrowUp')).toBe(1);
    expect(nextRow(5, 0, 'ArrowUp')).toBe(0);
  });

  it('jumps to the ends on Home and End', () => {
    expect(nextRow(5, 2, 'Home')).toBe(0);
    expect(nextRow(5, 2, 'End')).toBe(4);
  });

  it('leaves every other key alone', () => {
    expect(nextRow(5, 2, 'Enter')).toBeNull();
    expect(nextRow(5, 2, 'a')).toBeNull();
    expect(nextRow(0, 0, 'ArrowDown')).toBeNull();
  });
});
