import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { t } from '../i18n';
import { closeDockWindow, dockWindow, openDockWindow } from '../lib/dockWindow';
import { ipc } from '../lib/ipc';
import { useStore } from '../state/store';

/** Where the dock is drawn while it is in its own window. */
let mount: HTMLElement | null = null;

/**
 * Moves the dock into a window of its own. Called from the click itself —
 * the window has to be opened while the click is still being handled.
 */
export function detachDock(): void {
  const store = useStore.getState();
  const opened = openDockWindow(t('dock.windowTitle', { name: store.meta?.name ?? '' }).replace(/ — $/, ''), () => {
    mount = null;
    useStore.getState().setDockDetached(false);
  });
  if (!opened) {
    store.setStatusMessage(t('dock.detachRefused'));
    return;
  }
  // The dock moves once the window's page is there to draw into, and stays
  // where it is if it never comes.
  void opened.ready.then((el) => {
    if (!el) {
      void ipc.closeDockWindows().catch(() => undefined);
      useStore.getState().setStatusMessage(t('dock.detachRefused'));
      return;
    }
    mount = el;
    useStore.getState().setDockDetached(true);
  });
}

/** Brings the dock back into the main window. */
export function attachDock(): void {
  closeDockWindow();
  // The page's own close is not honoured by every engine; the application
  // closes the window from its side as well.
  void ipc.closeDockWindows().catch(() => undefined);
  mount = null;
  useStore.getState().setDockDetached(false);
}

/**
 * The dock, wherever it currently lives: in place in the main window, or in
 * its own. It is the same component either way, drawn by the same program
 * from the same state — only the window it lands in differs. In its own
 * window it stays up whichever screen the main window is showing.
 */
export function DockHost({ appClass, inPlace, children }: { appClass: string; inPlace: boolean; children: ReactNode }) {
  const detached = useStore((s) => s.dockDetached);
  // Asking for a panel from the main window — the rail, a device's menu —
  // brings the dock's window forward: that is where the panel now is.
  const tab = useStore((s) => s.dockTab);
  const asked = useStore((s) => s.panelRequest);
  useEffect(() => {
    if (detached) dockWindow()?.focus();
  }, [detached, tab, asked]);
  if (detached && mount) {
    return createPortal(<div className={`${appClass} cv-dock-window`}>{children}</div>, mount);
  }
  return inPlace ? <>{children}</> : null;
}
