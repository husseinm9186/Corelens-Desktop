/**
 * The page's link layout, where each link can read its own part of it.
 *
 * The layout is worked out once for the whole page (`layoutLinks`), because
 * where a link attaches depends on the other links at the same device. A link
 * reading the whole result would re-render whenever any link moved; so the
 * result is kept here, a link subscribes to its own entry, and an entry that
 * did not change keeps the object it had — moving one device re-renders the
 * links at it and their neighbours, and nothing else.
 */
import { useSyncExternalStore } from 'react';

import { type LinkLayout, sameLayout } from '../lib/linkLayout';

let current = new Map<string, LinkLayout>();
let changed = false;
const listeners = new Set<() => void>();

/** Replaces the layout. Entries equal to the ones before keep their identity.
 *  Subscribers hear on `notifyLinkLayout`, so this is safe to call while
 *  rendering — which is when the canvas has the page in hand. */
export function setLinkLayout(next: Map<string, LinkLayout>): void {
  if (next.size !== current.size) changed = true;
  for (const [id, lay] of next) {
    const was = current.get(id);
    if (sameLayout(was, lay)) next.set(id, was!);
    else changed = true;
  }
  current = next;
}

/** Tells the links whose entry changed. Called after the canvas commits. */
export function notifyLinkLayout(): void {
  if (!changed) return;
  changed = false;
  for (const l of listeners) l();
}

export function linkLayoutOf(id: string): LinkLayout | undefined {
  return current.get(id);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useLinkLayout(id: string): LinkLayout | undefined {
  return useSyncExternalStore(subscribe, () => current.get(id), () => current.get(id));
}

/** Test seam: module state would otherwise leak between cases. */
export function resetLinkLayout(): void {
  current = new Map();
  changed = false;
}
