import { describe, expect, it } from 'vitest';

import type { KeptStatus, LockView } from './ipc';
import { copyToOpen, folderName, heldBy, overwroteNotice } from './sharedProjects';

const when = (ms: number) => `t${ms}`;
const lock = (over: Partial<LockView> = {}): LockView =>
  ({ engineer: 'alex', machine: 'desk-7', sinceMs: 10, seenMs: 20, mine: false, stale: false, ...over });
const status = (over: Partial<KeptStatus> = {}): KeptStatus =>
  ({ folder: '/shared/branch-12', exists: true, updatedAt: 500, lock: null, ...over });

describe('which copy of a kept project opens', () => {
  it('the shared copy when it is newer, saying who saved it', () => {
    expect(copyToOpen(100, status(), when)).toEqual({ use: 'shared', notice: 'Opened the shared copy saved t500.' });
    expect(copyToOpen(100, status({ lock: lock() }), when).notice).toBe('Opened the shared copy saved t500 by alex on desk-7.');
    // One's own lock names nobody.
    expect(copyToOpen(100, status({ lock: lock({ mine: true }) }), when).notice).toBe('Opened the shared copy saved t500.');
  });

  it("this machine's copy when it is as new or newer, quietly", () => {
    expect(copyToOpen(500, status(), when)).toEqual({ use: 'local', notice: null });
    expect(copyToOpen(900, status(), when)).toEqual({ use: 'local', notice: null });
    expect(copyToOpen(900, null, when)).toEqual({ use: 'local', notice: null });
  });

  it("this machine's copy, and says so, when the shared one is gone", () => {
    const r = copyToOpen(100, status({ exists: false, updatedAt: null }), when);
    expect(r.use).toBe('local');
    expect(r.notice).toBe("The shared copy in /shared/branch-12 is missing, so this is this machine's copy.");
  });
});

describe('a lock held by somebody else', () => {
  it('is a banner naming them and the rule', () => {
    expect(heldBy(lock(), when)).toBe('alex on desk-7 has this project open since t10. If you both save, the later save wins.');
  });

  it("is nothing when the lock is free, this machine's, or left behind", () => {
    expect(heldBy(null, when)).toBeNull();
    expect(heldBy(lock({ mine: true }), when)).toBeNull();
    expect(heldBy(lock({ stale: true }), when)).toBeNull();
  });
});

describe('a save over a newer shared copy', () => {
  it('says whose it replaced', () => {
    expect(overwroteNotice({ folder: '/s', overwrote: 700, lock: lock() }, when)).toBe('Saved over a shared copy from t700 by alex on desk-7; theirs is gone.');
    expect(overwroteNotice({ folder: '/s', overwrote: 700, lock: null }, when)).toBe('Saved over a shared copy from t700; theirs is gone.');
    expect(overwroteNotice({ folder: '/s', overwrote: null, lock: lock() }, when)).toBeNull();
  });
});

describe('the folder a project is kept under', () => {
  it('is its name as a plain folder name', () => {
    expect(folderName('Branch 12 refresh', 'x')).toBe('branch-12-refresh');
    expect(folderName('  Café — HQ / core  ', 'x')).toBe('cafe-hq-core');
    expect(folderName('../escape', 'x')).toBe('escape');
    expect(folderName('///', 'p-1')).toBe('p-1');
  });
});
