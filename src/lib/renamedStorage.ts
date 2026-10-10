/**
 * Browser storage written under the app's earlier name, moved to the current
 * one before anything reads it.
 *
 * The view settings, the comment author, project summaries and recovery
 * copies are all kept under a `<name>.` prefix. When the app was renamed the
 * prefix changed with it, and without this the first start under the new
 * name would forget every one of them. Imported first by the entry point, so
 * it has run before the store reads a single key.
 *
 * Moved, not copied: the earlier version's own storage is a separate profile
 * the renamed app never writes to, so nothing is lost by removing the old key
 * here — and a copy left behind would come back after the new key was
 * deliberately cleared (a recovery copy, once saved, must stay gone).
 */

const PREFIX = 'corelens.';
/** Earlier prefixes, newest first. */
export const PREVIOUS_PREFIXES = ['coreview.'] as const;

/** Moves every key under an earlier prefix to the current one, unless the
 *  current one already holds that key. Returns how many were moved. */
export function adoptRenamedKeys(storage: Storage): number {
  let moved = 0;
  for (const old of PREVIOUS_PREFIXES) {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(old)) keys.push(key);
    }
    for (const key of keys) {
      const value = storage.getItem(key);
      const renamed = PREFIX + key.slice(old.length);
      if (value !== null && storage.getItem(renamed) === null) {
        storage.setItem(renamed, value);
        moved++;
      }
      storage.removeItem(key);
    }
  }
  return moved;
}

try {
  if (typeof localStorage !== 'undefined') adoptRenamedKeys(localStorage);
} catch {
  // Storage that cannot be read cannot be lost either; the app starts with
  // its defaults, as it would on a new machine.
}
