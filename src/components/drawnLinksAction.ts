/**
 * Fill in drawn links from the devices: the button's own work.
 *
 * Every device drawn on the page in front that has an address and a login
 * is asked who is on its ports — its neighbour tables, and its MAC, ARP and
 * interface tables for what speaks no neighbour protocol — a few at a
 * time. Only those devices: what one of them reports is never dialled, and
 * a neighbour that is not on the page is not put on it. What they said is then matched to what is drawn by
 * `fillDrawnLinks`, as one undo step.
 */
import { ipc } from '../lib/ipc';
import { clearDrawnMarks, fillDrawnLinks, type DeviceReading } from '../lib/drawnLinks';
import { uid } from '../lib/id';
import { activePage } from '../lib/pages';
import { planSsh } from '../lib/sshLaunch';
import { t } from '../i18n';
import { useStore } from '../state/store';
import type { DeviceNodeData } from '../types/domain';

/** How many devices are asked at once: enough not to crawl through a big
 *  page, few enough that a jump host or a TACACS server is not flooded. */
const AT_ONCE = 4;
let running = false;

export async function fillDrawnFromDevices() {
  if (running) return;
  const store = useStore.getState();
  const page = activePage(store.doc);
  const pageId = page.id;
  const projectSsh = store.doc.credentialDefaults?.ssh;
  // One question an address, however many times its device is drawn.
  const byAddress = new Map<string, { credentialId: string; label: string; nodeIds: string[] }>();
  for (const n of page.nodes) {
    if (n.type !== 'device') continue;
    const plan = planSsh(n.data as DeviceNodeData, projectSsh);
    if (!plan.ok) continue;
    const had = byAddress.get(plan.address);
    if (had) had.nodeIds.push(n.id);
    else byAddress.set(plan.address, { credentialId: plan.credentialId, label: plan.label, nodeIds: [n.id] });
  }
  const targets = [...byAddress.entries()];
  if (targets.length === 0) {
    store.setStatusMessage(t('drawn.nobody'));
    return;
  }
  running = true;
  const readings: DeviceReading[] = [];
  const failed: string[] = [];
  let done = 0;
  const say = () => useStore.getState().setStatusMessage(t('drawn.asking', { done, count: targets.length }));
  say();
  try {
    let next = 0;
    const worker = async () => {
      while (next < targets.length) {
        const [address, target] = targets[next++]!;
        try {
          const said = await ipc.getDeviceLinks(address, target.credentialId);
          // With what the device calls itself and its serials: whose answer
          // this is is checked against the device drawn at the address.
          for (const nodeId of target.nodeIds) readings.push({ nodeId, neighbors: said.neighbors, ports: said.ports, macs: said.macs, own: said.own, hostname: said.hostname, serials: said.serials });
        } catch {
          failed.push(target.label);
        }
        done += 1;
        say();
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, targets.length) }, worker));

    // The page as it is now: it may have been edited, or left, meanwhile.
    const now = useStore.getState().doc.pages.find((p) => p.id === pageId);
    if (!now) {
      useStore.getState().setStatusMessage(t('drawn.gone'));
      return;
    }
    const got = fillDrawnLinks(now.nodes, now.edges, readings, uid);
    if (got.edges !== now.edges) useStore.getState().setPageEdges(pageId, got.edges, 'Fill in drawn links');
    const links = (count: number) => t('drawn.plural.links', { count });
    useStore.getState().setStatusMessage(
      t('drawn.done', { asked: targets.length - failed.length, count: targets.length, met: links(got.met), unmet: got.unmet, management: got.management, added: got.added }) +
        (got.byMac ? t('drawn.doneByMac', { links: links(got.byMac) }) : '') +
        (got.unsure ? t('drawn.doneUnsure', { cables: t('drawn.plural.cables', { count: got.unsure }) }) : '') +
        (got.misplaced.length ? t('drawn.doneMisplaced', { names: got.misplaced.map((m) => t('drawn.doneMisplacedOne', { label: m.label, as: m.as })).join(', ') }) : '') +
        (got.shared.length ? t('drawn.doneShared', { names: got.shared.join(', ') }) : '') +
        (got.strangers ? t('drawn.doneStrangers', { strangers: t('drawn.plural.neighbours', { count: got.strangers }) }) : '') +
        (got.unasked ? t('drawn.doneUnasked', { unasked: links(got.unasked) }) : '') +
        (failed.length ? t('drawn.doneFailed', { names: failed.slice(0, 6).join(', ') + (failed.length > 6 ? '…' : '') }) : ''),
    );
  } finally {
    running = false;
  }
}

/** Takes the marks off the page in front; the ports that were filled in stay. */
export function clearDrawnFromDevices() {
  const store = useStore.getState();
  const page = activePage(store.doc);
  const got = clearDrawnMarks(page.edges);
  if (got.cleared === 0) {
    store.setStatusMessage(t('drawn.nothingToClear'));
    return;
  }
  store.setPageEdges(page.id, got.edges, 'Clear the marks on links');
  store.setStatusMessage(t('drawn.cleared', { count: got.cleared }));
}
