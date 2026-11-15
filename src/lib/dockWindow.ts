/**
 * The dock in a window of its own.
 *
 * The dock's tables and the terminal want room the diagram also wants, and
 * on a second screen there is room for both. The window opened here is a
 * blank page of this same application: the dock is drawn into it by the
 * same running program that draws the main window, so there is one project
 * in memory, one set of probe results, one set of sessions — nothing is
 * copied across and nothing can fall out of step.
 *
 * What a blank window does not have is the application's stylesheet, its
 * scale and its ground classes; those are carried over here and kept in
 * step while it is open.
 */

/** The name the window is opened under, so asking twice finds the same one. */
export const DOCK_WINDOW_NAME = 'corelens-dock';

let current: Window | null = null;

/** The detached dock's window while it is open, otherwise null. */
export function dockWindow(): Window | null {
  if (current && current.closed) current = null;
  return current;
}

/** The window a control in the dock belongs to: the detached one while the
 *  dock is out, the main one otherwise. For what only works in the window
 *  that has the focus — the clipboard above all. */
export function dockOwnerWindow(): Window {
  return dockWindow() ?? window;
}

/**
 * Copies every stylesheet of `from` into `to` and keeps them in step: the
 * development server adds and replaces `<style>` elements as files change.
 * Returns what stops it.
 */
export function mirrorStyles(from: Document, to: Document): () => void {
  const MARK = 'data-mirrored';
  const sync = () => {
    for (const old of [...to.head.querySelectorAll(`[${MARK}]`)]) old.remove();
    for (const node of from.head.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')) {
      let copy: HTMLElement;
      if (node instanceof HTMLLinkElement) {
        const link = to.createElement('link');
        link.rel = 'stylesheet';
        // Absolute: a blank page has no address of its own to resolve against.
        link.href = node.href;
        copy = link;
      } else {
        const style = to.createElement('style');
        style.textContent = node.textContent;
        copy = style;
      }
      copy.setAttribute(MARK, '');
      to.head.appendChild(copy);
    }
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(from.head, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

/** The root element's scale and classes, carried to the other document and
 *  kept in step. Returns what stops it. */
export function mirrorRoot(from: Document, to: Document): () => void {
  const sync = () => {
    to.documentElement.className = from.documentElement.className;
    to.documentElement.style.cssText = from.documentElement.style.cssText;
    to.documentElement.lang = from.documentElement.lang;
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(from.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'lang'] });
  return () => observer.disconnect();
}

export interface OpenedDock {
  window: Window;
  /** The element the dock is drawn into, once the window's page is there;
   *  null when it never arrived. */
  ready: Promise<HTMLElement | null>;
}

/** The page the dock's window shows: one empty element to draw into. It is
 *  a page of this application so that the two windows are one origin and
 *  the main one may reach into it. */
export const DOCK_PAGE = 'dock.html';

const READY_WITHIN_MS = 8000;

/** The element to draw into, if the window has finished loading its page. */
function mountOf(opened: Window): HTMLElement | null {
  try {
    if (!opened.location.pathname.endsWith(`/${DOCK_PAGE}`)) return null;
    if (opened.document.readyState !== 'complete') return null;
    return opened.document.getElementById('dock-root');
  } catch {
    // Not ours to read yet: still on the blank page it opened with.
    return null;
  }
}

/**
 * Opens the dock's window. Must be called from a click: a window opened at
 * any other moment is one a browser engine refuses. Null when it was
 * refused all the same. `onClosed` is told when the window goes, whoever
 * closed it.
 */
export function openDockWindow(title: string, onClosed: () => void): OpenedDock | null {
  const existing = dockWindow();
  if (existing) {
    existing.focus();
    const mount = mountOf(existing);
    if (mount) return { window: existing, ready: Promise.resolve(mount) };
  }
  let opened: Window | null = null;
  try {
    opened = window.open(new URL(DOCK_PAGE, document.baseURI).href, DOCK_WINDOW_NAME, 'popup=yes,width=1040,height=760');
  } catch {
    opened = null;
  }
  if (!opened) return null;
  const win = opened;
  current = win;

  let stopMirrors = () => {};
  let told = false;
  const closed = () => {
    if (told) return;
    told = true;
    window.clearInterval(watch);
    stopMirrors();
    window.removeEventListener('pagehide', closeWithMain);
    if (current === win) current = null;
    onClosed();
  };
  // Closing the main window takes this one with it: on its own it would be
  // an empty frame.
  const closeWithMain = () => win.close();
  window.addEventListener('pagehide', closeWithMain);
  // Not every engine tells the opener that its window went; looking is cheap.
  const watch = window.setInterval(() => {
    if (win.closed) closed();
  }, 400);

  const ready = new Promise<HTMLElement | null>((resolve) => {
    const started = Date.now();
    const look = () => {
      if (told || win.closed) return resolve(null);
      const mount = mountOf(win);
      if (mount) {
        const doc = win.document;
        // A window of this name left from before a reload has the old dock.
        mount.replaceChildren();
        doc.title = title;
        doc.body.className = document.body.className;
        const stopStyles = mirrorStyles(document, doc);
        const stopRoot = mirrorRoot(document, doc);
        stopMirrors = () => {
          stopStyles();
          stopRoot();
        };
        win.addEventListener('pagehide', closed);
        return resolve(mount);
      }
      if (Date.now() - started > READY_WITHIN_MS) {
        win.close();
        closed();
        return resolve(null);
      }
      window.setTimeout(look, 40);
    };
    look();
  });
  return { window: win, ready };
}

/** Closes the dock's window, if it is open. */
export function closeDockWindow(): void {
  const w = dockWindow();
  current = null;
  w?.close();
}
