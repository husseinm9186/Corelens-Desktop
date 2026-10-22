/**
 * Projects kept in a folder every engineer's machine sees — the rules the
 * page applies to what Rust reports about the shared copy and its lock.
 *
 * Each machine's database is the working copy; the shared copy is written
 * after every save and read before every open. Which copy opens, what the
 * status line says about it, and what a lock held by somebody else means
 * are decided here, in words the screen shows as they are.
 */
import type { KeptStatus, KeptWritten, LockView } from './ipc';

/** How a time is written into a notice. */
export type Clock = (ms: number) => string;

/** The folder a project is kept under: its name as a plain folder name,
 *  or the fallback when nothing of the name survives. */
export function folderName(name: string, fallback: string): string {
  const plain = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return plain || fallback;
}

const holder = (lock: LockView | null | undefined): string =>
  lock && !lock.mine ? ` by ${lock.engineer} on ${lock.machine}` : '';

/** Which copy of a kept project opens, and what to say about it. */
export function copyToOpen(
  localUpdatedAt: number,
  shared: KeptStatus | null,
  when: Clock,
): { use: 'local' | 'shared'; notice: string | null } {
  if (!shared) return { use: 'local', notice: null };
  if (!shared.exists || shared.updatedAt === null) {
    return { use: 'local', notice: `The shared copy in ${shared.folder} is missing, so this is this machine's copy.` };
  }
  if (shared.updatedAt > localUpdatedAt) {
    return { use: 'shared', notice: `Opened the shared copy saved ${when(shared.updatedAt)}${holder(shared.lock)}.` };
  }
  return { use: 'local', notice: null };
}

/** The banner while somebody else has the project open; nothing when
 *  the lock is free, this machine's, or left behind by a session that is
 *  gone. */
export function heldBy(lock: LockView | null | undefined, when: Clock): string | null {
  if (!lock || lock.mine || lock.stale) return null;
  return `${lock.engineer} on ${lock.machine} has this project open since ${when(lock.sinceMs)}. If you both save, the later save wins.`;
}

/** What a save says when it replaced a shared copy newer than the one
 *  this machine last saw. */
export function overwroteNotice(written: KeptWritten, when: Clock): string | null {
  if (written.overwrote === null) return null;
  return `Saved over a shared copy from ${when(written.overwrote)}${holder(written.lock)}; theirs is gone.`;
}
