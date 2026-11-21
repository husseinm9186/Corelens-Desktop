import { beforeAll, describe, expect, it, vi } from 'vitest';
import { followPointer } from './pointerDrag';

const pointer = (type: string) => new Event(type);

describe('followPointer', () => {
  beforeAll(() => {
    // The window the drag also listens on, for losing focus.
    (globalThis as { window?: unknown }).window ??= new EventTarget();
  });

  it('follows until let go, then applies once and listens no more', () => {
    const t = new EventTarget();
    const move = vi.fn();
    const done = vi.fn();
    const cancelled = vi.fn();
    followPointer(t, move, done, cancelled);
    t.dispatchEvent(pointer('pointermove'));
    t.dispatchEvent(pointer('pointerup'));
    t.dispatchEvent(pointer('pointermove'));
    t.dispatchEvent(pointer('pointerup'));
    expect(move).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('ends without applying when the system cancels the gesture', () => {
    const t = new EventTarget();
    const move = vi.fn();
    const done = vi.fn();
    const cancelled = vi.fn();
    followPointer(t, move, done, cancelled);
    t.dispatchEvent(pointer('pointercancel'));
    t.dispatchEvent(pointer('pointermove'));
    t.dispatchEvent(pointer('pointerup'));
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(done).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
  });

  it('ends when the window loses focus mid-drag, and can be ended by hand', () => {
    const t = new EventTarget();
    const cancelled = vi.fn();
    followPointer(t, () => {}, () => {}, cancelled);
    window.dispatchEvent(new Event('blur'));
    expect(cancelled).toHaveBeenCalledTimes(1);
    const again = vi.fn();
    const end = followPointer(t, () => {}, () => {}, again);
    end();
    end();
    window.dispatchEvent(new Event('blur'));
    expect(again).toHaveBeenCalledTimes(1);
  });
});
