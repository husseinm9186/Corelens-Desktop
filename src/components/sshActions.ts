/**
 * Opening a shell on a device: from the canvas menu, and
 * from the inspector's action row. One place, so both ask the same
 * questions in the same order and report the same refusals.
 */
import { ipc } from '../lib/ipc';
import { fillDeviceInfo } from '../lib/deviceInfo';
import { choosePort, shortPort } from '../lib/consolePort';
import { planSsh, sshAddress, sshLabel } from '../lib/sshLaunch';
import { t } from '../i18n';
import { useStore } from '../state/store';
import type { DeviceNodeData } from '../types/domain';

/**
 * Opens a shell on a device and puts its tab in front.
 *
 * The two ways this fails before anything is sent — no address, no credential
 * of its own — are decided by `planSsh` and reported as themselves. A timeout
 * would be the wrong answer to both.
 *
 * With `via`, the session goes through that neighbour: this machine logs in
 * to it, and it to the device, with the same login.
 */
export async function openSsh(nodeId: string, data: DeviceNodeData, via?: { address: string; label: string }) {
  const store = useStore.getState();
  // The project's login is what a device with none of its own uses.
  const plan = planSsh(data, store.doc.credentialDefaults?.ssh);
  if (!plan.ok) {
    store.setStatusMessage(t(plan.reason === 'noAddress' ? 'ssh.noAddress' : 'ssh.noCredential'));
    return;
  }
  store.setStatusMessage(via ? t('ssh.openingThrough', { name: plan.label, via: via.label }) : t('ssh.opening', { name: plan.label }));
  store.requestPanelTab('ssh');
  // The panel's own event listener turns each login stage into the
  // status line while this open is pending, so the wait is legible instead
  // of a frozen "Connecting…".
  try {
    // A size the device can use straight away; the terminal tells it the real
    // one as soon as it has been laid out.
    const { keepaliveSeconds, logByDefault } = store.settings.terminal;
    const id = await ipc.sshOpen(plan.address, plan.credentialId, { cols: 120, rows: 30 }, undefined, keepaliveSeconds, via?.address);
    useStore.getState().openSshTab({ id, address: plan.address, label: plan.label, nodeId, status: 'open', credentialId: plan.credentialId, ...(via ? { via } : {}) });
    useStore.getState().setStatusMessage(null);
    // Logging every session without being asked each time.
    const folder = useStore.getState().settings.backupFolder;
    if (logByDefault && folder) {
      await ipc
        .sshLogStart(id, { folder, device: plan.label, address: plan.address, site: data.site ?? '' })
        .catch((e: unknown) => useStore.getState().setStatusMessage(e instanceof Error ? e.message : String(e)));
    }
  } catch (e: unknown) {
    useStore.getState().setStatusMessage(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Hands the device to whatever terminal the machine already has.
 *
 * The username goes with it and the password does not: every external client
 * that takes one takes it on a command line, where the rest of the machine can
 * read it. The client asks. Corelens then knows nothing about the session —
 * no transcript, no colouring, no keepalive, which is what the panel is for.
 */
export async function openSshElsewhere(data: DeviceNodeData) {
  const store = useStore.getState();
  const address = sshAddress(data);
  if (!address) {
    store.setStatusMessage(t('ssh.noAddress'));
    return;
  }
  try {
    const argv = await ipc.sshExternal(address, await sshUsername(data), undefined, store.settings.terminal.externalCommand);
    store.setStatusMessage(t('ssh.externalRan', { command: argv[0] ?? '' }));
  } catch (e: unknown) {
    store.setStatusMessage(e instanceof Error ? e.message : String(e));
  }
}

/**
 * The username an external client should be handed.
 *
 * It comes out of the vault's *summary* — the label and username of a saved
 * credential, which is not a secret and is already listed in Settings. The
 * password stays where it is. With no credential chosen there is nothing to
 * pass, and the client asks for both.
 */
async function sshUsername(data: DeviceNodeData): Promise<string> {
  const id = data.sshCredentialId?.trim();
  if (!id) return '';
  const saved = await ipc.listCredentials().catch(() => []);
  return saved.find((c) => c.id === id)?.username ?? '';
}

/**
 * Asks one device what it is and writes what it said into its fields.
 *
 * Not a crawl: one login to this device's own address with its own login
 * (or the project's), identity questions only, and no other device
 * contacted. The status line says what was asked, so whoever pressed it can
 * tell a network's owner exactly what was sent.
 */
export async function getDeviceInfo(nodeId: string, data: DeviceNodeData) {
  const store = useStore.getState();
  const plan = planSsh(data, store.doc.credentialDefaults?.ssh);
  if (!plan.ok) {
    store.setStatusMessage(t(plan.reason === 'noAddress' ? 'ssh.noAddress' : 'ssh.noCredential'));
    return;
  }
  store.setStatusMessage(t('deviceInfo.asking', { name: plan.label }));
  try {
    const info = await ipc.getDeviceInfo(plan.address, plan.credentialId);
    // The project as it is now: the device may have been edited while this
    // ran, and the page in front may be another one. Every drawing of the
    // device is filled, on whatever page it is.
    const state = useStore.getState();
    const { pages, filled, changed } = fillDeviceInfo(state.doc.pages, nodeId, info, Date.now(), plan.address);
    if (filled.length === 0) {
      state.setStatusMessage(t('deviceInfo.gone', { name: plan.label }));
      return;
    }
    useStore.setState((s) => ({ doc: { ...s.doc, pages }, dirty: true }));
    // The primary check follows the primary address, as after any edit of it.
    for (const id of filled) useStore.getState().ensureNodeCheck(id);
    const asked = info.commands.join(', ');
    // Said only when there is more than one, so the usual case reads as before.
    const drawings = filled.length > 1 ? t('deviceInfo.drawings', { count: filled.length }) : '';
    state.setStatusMessage(
      (changed.length
        ? t('deviceInfo.filled', { name: plan.label, fields: changed.join(', '), asked })
        : t('deviceInfo.nothingNew', { name: plan.label, asked })) + drawings,
    );
  } catch (e: unknown) {
    useStore.getState().setStatusMessage(t('deviceInfo.failed', { name: plan.label, why: e instanceof Error ? e.message : String(e) }));
  }
}

/**
 * Opens a serial console in the terminal panel, beside the SSH sessions.
 *
 * The port is found, not asked for: the machine's serial ports are listed
 * and the only USB serial adapter among them — the console cable — is
 * opened. With two cables in, or none, nothing is opened and the status
 * line says to choose on the Console tab: a guess would type into the wrong
 * device. `wanted` is a port somebody did choose.
 *
 * Nothing is sent to the device by opening it. From a device's menu the tab
 * carries the device's name; the cable is still whichever one is plugged in
 * — Corelens cannot tell what is at the other end of it.
 *
 * Returns the ports it found, so the panel can offer them.
 */
export async function openConsole(wanted = '', from?: { nodeId: string; data: DeviceNodeData }) {
  const store = useStore.getState();
  store.requestPanelTab('console');
  try {
    const found = await ipc.consolePorts();
    const choice = choosePort(found.ports, found.chosen, wanted);
    if ('ask' in choice) {
      store.setStatusMessage(t(choice.ask === 'none' ? 'console.noPorts' : choice.ask === 'noCable' ? 'console.noCable' : 'console.several'));
      return found.ports;
    }
    const baud = store.settings.terminal.consoleBaud;
    const port = shortPort(choice.open);
    store.setStatusMessage(t('console.opening', { port, baud }));
    const id = await ipc.consoleOpen(choice.open, baud);
    const label = from ? t('console.tabDevice', { name: sshLabel(from.data) }) : t('console.tab', { port });
    useStore.getState().openSshTab({
      id, address: port, label, status: 'open', console: { port: choice.open, baud },
      ...(from ? { nodeId: from.nodeId } : {}),
    });
    useStore.getState().setStatusMessage(t('console.opened', { port, baud }));
    const { logByDefault } = useStore.getState().settings.terminal;
    const folder = useStore.getState().settings.backupFolder;
    if (logByDefault && folder) {
      await ipc
        .sshLogStart(id, { folder, device: label, address: port, site: from?.data.site ?? '' })
        .catch((e: unknown) => useStore.getState().setStatusMessage(e instanceof Error ? e.message : String(e)));
    }
    return found.ports;
  } catch (e: unknown) {
    useStore.getState().setStatusMessage(e instanceof Error ? e.message : String(e));
    return null;
  }
}
