import { describe, expect, it } from 'vitest';

import { clippedTitle, type FieldLook } from './clippedTitle';

const field = (over: Partial<FieldLook>): FieldLook => ({ type: 'text', value: '198.51.100.100', scrollWidth: 120, clientWidth: 60, title: null, ours: false, ...over });

describe('a field too short for its value', () => {
  it('says the value when it is cut, and only then', () => {
    expect(clippedTitle(field({}))).toBe('198.51.100.100');
    expect(clippedTitle(field({ scrollWidth: 60 }))).toBeUndefined();
    expect(clippedTitle(field({ scrollWidth: 61 }))).toBeUndefined();
    expect(clippedTitle(field({ value: '' }))).toBeUndefined();
  });

  it('follows the value as it is typed, and stops once it fits', () => {
    expect(clippedTitle(field({ title: '198.51.100.1', ours: true }))).toBe('198.51.100.100');
    expect(clippedTitle(field({ title: '198.51.100.100', ours: true }))).toBeUndefined();
    expect(clippedTitle(field({ title: '198.51.100.100', ours: true, scrollWidth: 60 }))).toBeNull();
  });

  it('leaves a title somebody wrote alone', () => {
    expect(clippedTitle(field({ title: 'The management address' }))).toBeUndefined();
    expect(clippedTitle(field({ title: '' }))).toBeUndefined();
  });

  it('never says what a field hides', () => {
    expect(clippedTitle(field({ type: 'password', value: 'not-a-real-secret' }))).toBeUndefined();
    expect(clippedTitle(field({ type: 'PASSWORD', value: 'not-a-real-secret' }))).toBeUndefined();
    // One that was text and is now hidden loses what was said of it.
    expect(clippedTitle(field({ type: 'password', title: 'x', ours: true }))).toBeNull();
    for (const type of ['checkbox', 'file', 'range', 'color', 'hidden']) expect(clippedTitle(field({ type }))).toBeUndefined();
  });
});
