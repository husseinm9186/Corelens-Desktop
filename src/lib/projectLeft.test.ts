import { describe, expect, it } from 'vitest';

import { onProjectLeft, projectLeft } from './projectLeft';

describe('what is let go of when a project is closed', () => {
  it('calls every forgetter, and one that throws does not stop the rest', () => {
    const seen: string[] = [];
    onProjectLeft(() => seen.push('a'));
    onProjectLeft(() => {
      throw new Error('no');
    });
    onProjectLeft(() => seen.push('c'));
    projectLeft();
    expect(seen).toEqual(['a', 'c']);
    projectLeft();
    expect(seen).toEqual(['a', 'c', 'a', 'c']);
  });
});
