import { describe, expect, it } from 'vitest';

import { linkCountsOf } from './linkCounts';

const edge = (id: string, source: string, target: string, kind?: 'leader') =>
  ({ id, source, target, type: 'live', data: kind ? { kind } : {} });

describe('linkCountsOf', () => {
  it('counts each end of each link', () => {
    const counts = linkCountsOf([edge('1', 'a', 'b'), edge('2', 'a', 'c'), edge('3', 'b', 'c')]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(2);
    expect(counts.get('c')).toBe(2);
  });

  it('does not count a leader, which points a note and is not a link', () => {
    expect(linkCountsOf([edge('1', 'note', 'a', 'leader')]).get('a')).toBeUndefined();
  });

  it('works the counts out once per list of links', () => {
    const edges = [edge('1', 'a', 'b')];
    expect(linkCountsOf(edges)).toBe(linkCountsOf(edges));
  });
});
