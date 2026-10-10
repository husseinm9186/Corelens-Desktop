/**
 * Where every link wants its port chips, so they can be pushed apart.
 *
 * A link only knows its own chips, and the overlaps worth fixing are
 * between links: two cables leaving neighbouring ports, or one device's chip
 * reaching the next one's. Each link registers where it would put its chips
 * left alone, and reads back where they go once all of them have been pushed
 * apart in one pass. What is registered is never the pushed position, so a
 * chip moving cannot set the others moving.
 *
 * As with the paths, subscribers hear after a short quiet period, and the
 * pass is worked out once per settled version, by whichever link asks first.
 */
import { pushChips, type ChipBox } from '../../lib/portLabels';

const chips = new Map<string, ChipBox>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let version = 0;
let pushedAt = -1;
let pushed = new Map<string, { dx: number; dy: number }>();

const QUIET_MS = 90;

function scheduleNotify(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    version += 1;
    for (const l of listeners) l();
  }, QUIET_MS);
}

const same = (a: ChipBox | undefined, b: ChipBox) =>
  !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.ux === b.ux && a.uy === b.uy && a.fixed === b.fixed;

export function registerChip(c: ChipBox): void {
  if (same(chips.get(c.key), c)) return;
  chips.set(c.key, c);
  scheduleNotify();
}

export function forgetChip(key: string): void {
  if (!chips.delete(key)) return;
  scheduleNotify();
}

export function chipVersion(): number {
  return version;
}

export function subscribeChips(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** How far a chip is pushed to clear the others, as of the last settled
 *  register. An offset rather than a place, so a chip whose device is
 *  being dragged follows it at once instead of waiting for the register to
 *  settle; the offset itself catches up when it does. */
export function chipPush(key: string): { dx: number; dy: number } {
  if (pushedAt !== version) {
    pushed = new Map();
    for (const [k, at] of pushChips([...chips.values()])) {
      const c = chips.get(k)!;
      if (at.x !== c.x || at.y !== c.y) pushed.set(k, { dx: at.x - c.x, dy: at.y - c.y });
    }
    pushedAt = version;
  }
  return pushed.get(key) ?? NONE;
}

const NONE = { dx: 0, dy: 0 };

/** Test seam: the register is module state. */
export function resetChips(): void {
  chips.clear();
  pushed = new Map();
  pushedAt = -1;
  if (timer) clearTimeout(timer);
  timer = null;
  version = 0;
}
