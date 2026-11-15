/**
 * Closing a project leaves nothing of it in the window.
 *
 * Two customers' networks are two projects. What one project's runs found,
 * what was copied from its diagram, what its panels were asked — all of it
 * names that customer's devices, and all of it used to still be there when
 * the next project opened: a finished discovery was handed to the next
 * project's review, the collector's last lines were on its Collect tab, and
 * a copy could be pasted across.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ipc } from '../lib/ipc';
import { onProjectLeft } from '../lib/projectLeft';
import { useStore } from './store';

const meta = { id: 'p-a', name: 'Customer A', customer: '', site: '', ticket: '', engineer: '', description: '', createdAt: 1, updatedAt: 1, archived: false };

afterEach(() => vi.restoreAllMocks());

describe('closing a project', () => {
  it('ends its jobs and drops everything they found, asked and copied', async () => {
    const cancelled: string[] = [];
    vi.spyOn(ipc, 'cancelCrawl').mockImplementation(async () => { cancelled.push('crawl'); });
    vi.spyOn(ipc, 'cancelCollection').mockImplementation(async () => { cancelled.push('collection'); });
    vi.spyOn(ipc, 'cancelBackup').mockImplementation(async () => { cancelled.push('backup'); });
    let forgotten = 0;
    onProjectLeft(() => { forgotten += 1; });

    // One device on the page, selected the way the canvas marks it.
    const device = { id: 'n1', type: 'device', position: { x: 0, y: 0 }, selected: true, data: { label: 'CORE-A-01', deviceClass: 'switch', address: '192.0.2.1' } };
    useStore.setState((st) => ({ doc: { ...st.doc, pages: st.doc.pages.map((p, n) => (n === 0 ? { ...p, nodes: [device as never] } : p)) } }));
    useStore.getState().copySelection();
    expect(useStore.getState().canPaste(), 'the copy was taken').toBe(true);

    useStore.setState({
      meta,
      dirty: false,
      pendingCrawlResult: { devices: [{ address: '192.0.2.1' }], notVisited: [], failures: [], cancelled: false } as never,
      discoverRun: { runId: 'col-1' } as never,
      collectionRun: { busy: true, live: ['Collecting 192.0.2.1'], finished: null } as never,
      tracertRun: { ...useStore.getState().tracertRun, hops: [{ ip: '192.0.2.254' }] as never },
      jobs: [{ id: 1, kind: 'crawl', state: 'running', phase: 'Visiting 192.0.2.1', done: 0, total: null }] as never,
      pathQuestion: { to: '192.0.2.77', app: '', protocol: 'tcp', port: '443', vrf: 'CUSTOMER-A' },
      backupHandover: { addresses: ['192.0.2.1'] } as never,
      canvasFilter: 'core-a' as never,
      statusMessage: 'Backed up CORE-A-01',
      drawer: { kind: 'finding' } as never,
      drawerPinned: true,
    });

    await useStore.getState().closeProject();

    const after = useStore.getState();
    expect(cancelled.sort()).toEqual(['backup', 'collection', 'crawl']);
    expect(forgotten, 'each panel was told to forget its own').toBe(1);
    expect(after.meta).toBeNull();
    expect(after.pendingCrawlResult).toBeNull();
    expect(after.discoverRun).toBeNull();
    expect(after.collectionRun).toEqual({ busy: false, live: [], finished: null });
    expect(after.tracertRun.hops).toBeNull();
    expect(after.jobs).toEqual([]);
    expect(after.pathQuestion).toEqual({ to: '', app: '', protocol: 'tcp', port: '', vrf: '' });
    expect(after.backupHandover).toBeNull();
    expect(after.canvasFilter).toBeNull();
    expect(after.statusMessage).toBeNull();
    expect(after.drawer).toBeNull();
    expect(after.drawerPinned).toBe(false);
    expect(after.canPaste(), 'a copy from one project can be pasted into the next').toBe(false);
    // Nothing of the first project is anywhere in what is left.
    const left = JSON.stringify({ ...after, doc: undefined, projects: undefined }, (_k, v) => (v instanceof Map ? [...v] : typeof v === 'function' ? undefined : v));
    expect(left).not.toContain('192.0.2.');
    expect(left).not.toContain('CUSTOMER-A');
  });
});
