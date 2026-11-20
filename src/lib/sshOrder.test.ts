import { describe, expect, it } from 'vitest';
import { moveSession, nudgeSession } from './sshOrder';

const tabs = () => ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id.toUpperCase() }));
const order = (l: { id: string }[]) => l.map((t) => t.id).join('');

describe('the order of the session tabs', () => {
  it('a tab dragged right takes the place of the one it is dropped on', () => {
    expect(order(moveSession(tabs(), 'a', 'c'))).toBe('bcad');
  });

  it('and dragged left, likewise', () => {
    expect(order(moveSession(tabs(), 'd', 'b'))).toBe('adbc');
  });

  it('to either end', () => {
    expect(order(moveSession(tabs(), 'a', 'd'))).toBe('bcda');
    expect(order(moveSession(tabs(), 'd', 'a'))).toBe('dabc');
  });

  it('the sessions themselves are the same objects, only elsewhere', () => {
    const had = tabs();
    const got = moveSession(had, 'a', 'c');
    expect(got.find((t) => t.id === 'a')).toBe(had[0]);
    expect(had.map((t) => t.id).join('')).toBe('abcd');
  });

  it('dropped on itself, or naming a tab that has gone, changes nothing', () => {
    const had = tabs();
    expect(moveSession(had, 'b', 'b')).toBe(had);
    expect(moveSession(had, 'gone', 'b')).toBe(had);
    expect(moveSession(had, 'b', 'gone')).toBe(had);
  });

  it('the keyboard moves one place, and stops at the ends', () => {
    const had = tabs();
    expect(order(nudgeSession(had, 'b', 1))).toBe('acbd');
    expect(order(nudgeSession(had, 'b', -1))).toBe('bacd');
    expect(nudgeSession(had, 'a', -1)).toBe(had);
    expect(nudgeSession(had, 'd', 1)).toBe(had);
  });
});
