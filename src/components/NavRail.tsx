/**
 * The rail: one column of the modes this app has, always in
 * sight, so Addresses and Tools stop being detours reached from the top bar
 * and the dock's tabs have a name you can press without the dock being open.
 *
 * Two blocks: the modes that keep the diagram — Diagram, and Discover,
 * Monitor, Paths, Backups and Terminal, which are the dock's tabs opened
 * through the same request the inspector already uses — then, after a
 * rule, the screens that take its place: Addresses, Racks, Inventory.
 * Settings is at the foot. The one that is showing is marked
 * `aria-current`.
 *
 * To the keyboard it is one stop: a tab list whose arrows, Home and End move
 * between the items and Enter opens one, and Ctrl with a digit jumps
 * straight to the first nine from anywhere — the digit shows in each item's
 * corner while Ctrl is held.
 */
import { Fragment, useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { useStore, type DockTab } from '../state/store';

type Mode = 'diagram' | 'discover' | 'monitor' | 'paths' | 'backups' | 'racks' | 'addresses' | 'inventory' | 'terminal' | 'settings';

const DOCK: Partial<Record<Mode, DockTab>> = { discover: 'crawl', monitor: 'objects', paths: 'trace', backups: 'backup', terminal: 'ssh' };
const DOCK_MODE: Partial<Record<DockTab, Mode>> = {
  crawl: 'discover', discover: 'discover', collect: 'discover',
  objects: 'monitor', events: 'monitor', compare: 'monitor',
  trace: 'paths', path: 'paths', tracert: 'paths', whereis: 'paths',
  backup: 'backups',
  ssh: 'terminal',
};

/** The class the top bar's button carried before the rail: the
 * harnesses and the guide reach Tools and Addresses by it, and it still
 * names the same thing. */
const HANDLE: Partial<Record<Mode, string>> = { addresses: 'cv-btn-register' };

/** Simple strokes, drawn here rather than imported: no artwork ships that is not ours. */
function Glyph({ mode }: { mode: Mode }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (mode) {
    case 'diagram':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><rect x="3" y="3" width="5" height="4" rx="1" /><rect x="12" y="3" width="5" height="4" rx="1" /><rect x="7.5" y="13" width="5" height="4" rx="1" /><path d="M5.5 7v3h9V7M10 10v3" /></g></svg>;
    case 'discover':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><circle cx="10" cy="10" r="7" /><circle cx="10" cy="10" r="3" /><path d="M10 3v2M10 15v2M3 10h2M15 10h2" /></g></svg>;
    case 'monitor':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><path d="M2 11h4l2-6 3 10 2-6 2 2h3" /></g></svg>;
    case 'paths':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><circle cx="4" cy="15" r="2" /><circle cx="16" cy="5" r="2" /><path d="M6 15h4a3 3 0 0 0 3-3V8a3 3 0 0 1 3-3" /></g></svg>;
    case 'backups':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><rect x="3" y="4" width="14" height="4" rx="1" /><path d="M4 8v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8M8 12h4" /></g></svg>;
    case 'addresses':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><path d="M7 3 5 17M15 3l-2 14M3 8h15M2 13h15" /></g></svg>;
    case 'racks':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><rect x="4" y="2" width="12" height="16" rx="1" /><path d="M6 6h8M6 9.5h8M6 13h8M6 16h8M4 2v-0M4 18v1M16 18v1" /></g></svg>;
    case 'inventory':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><rect x="3" y="3" width="14" height="14" rx="1.5" /><path d="M6 7h8M6 10h8M6 13h5" /></g></svg>;
    case 'terminal':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><rect x="2.5" y="4" width="15" height="12" rx="1.5" /><path d="M6 8l3 2-3 2M10 13h4" /></g></svg>;
    case 'settings':
      return <svg viewBox="0 0 20 20" aria-hidden><g {...p}><circle cx="10" cy="10" r="2.5" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" /></g></svg>;
  }
}

export function NavRail() {
  const registerOpen = useStore((s) => s.registerOpen);
  const toolsOpen = useStore((s) => s.toolsOpen);
  const toolsView = useStore((s) => s.toolsView);
  const helpOpen = useStore((s) => s.helpOpen);
  const panelOpen = useStore((s) => s.panelOpen);
  const dockTab = useStore((s) => s.dockTab);

  const current: Mode | null = registerOpen
    ? 'addresses'
    : toolsOpen
      ? toolsView === 'racks' ? 'racks' : toolsView === 'lifecycle' ? 'inventory' : 'settings'
      : helpOpen
        ? null
        : panelOpen
          ? (DOCK_MODE[dockTab] ?? 'diagram')
          : 'diagram';

  const go = (mode: Mode) => {
    const s = useStore.getState();
    switch (mode) {
      case 'diagram':
        s.setRegisterOpen(false);
        s.setToolsOpen(false);
        s.setHelpOpen(false);
        return;
      case 'addresses':
        s.setRegisterOpen(true);
        return;
      case 'inventory':
        s.setToolsOpen(true, 'lifecycle');
        return;
      // The rack elevations, from the rail.
      case 'racks':
        s.setToolsOpen(true, 'racks');
        return;
      case 'settings':
        s.setToolsOpen(true, 'settings');
        return;
      default: {
        s.setRegisterOpen(false);
        s.setToolsOpen(false);
        s.setHelpOpen(false);
        const tab = DOCK[mode];
        if (tab) s.requestPanelTab(tab);
      }
    }
  };

  const items: { mode: Mode; label: string }[] = [
    { mode: 'diagram', label: t('nav.diagram') },
    { mode: 'discover', label: t('nav.discover') },
    { mode: 'monitor', label: t('nav.monitor') },
    { mode: 'paths', label: t('nav.paths') },
    { mode: 'backups', label: t('nav.backups') },
    { mode: 'terminal', label: t('nav.terminal') },
    // The screens, after a rule: these take the canvas's place.
    { mode: 'addresses', label: t('nav.addresses') },
    { mode: 'racks', label: t('nav.racks') },
    { mode: 'inventory', label: t('nav.inventory') },
  ];
  const all = [...items, { mode: 'settings' as Mode, label: t('nav.settings') }];

  // Which item holds the one tab stop: the current one, until the arrows move it.
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const currentAt = Math.max(0, all.findIndex((i) => i.mode === current));
  const stop = focusAt ?? currentAt;
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const moveTo = (i: number) => {
    const n = (i + all.length) % all.length;
    setFocusAt(n);
    buttons.current[n]?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    const at = buttons.current.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    moveTo(to);
  };

  // Ctrl and a digit, from anywhere; and the digits on show while Ctrl is down.
  const [keys, setKeys] = useState(false);
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Control') setKeys(true);
      if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
      const item = n ? items[n - 1] : undefined;
      if (!item) return;
      e.preventDefault();
      setKeys(false);
      goRef.current(item.mode);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Control') setKeys(false);
    };
    const away = () => setKeys(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', away);
    };
    // The items are the same nine every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <nav
      className={`cv-nav${keys ? ' is-keys' : ''}`}
      aria-label={t('nav.title')}
      data-region="nav"
      role="tablist"
      aria-orientation="vertical"
      onKeyDown={onKey}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusAt(null);
      }}
    >
      {all.map((i, n) => (
        <Fragment key={i.mode}>
          {i.mode === 'settings' && <span className="cv-nav-space" />}
          {i.mode === 'addresses' && <span className="cv-nav-rule" role="presentation" />}
          <button
            ref={(el) => {
              buttons.current[n] = el;
            }}
            type="button"
            role="tab"
            aria-selected={current === i.mode}
            tabIndex={n === stop ? 0 : -1}
            className={`cv-nav-item${HANDLE[i.mode] ? ` ${HANDLE[i.mode]}` : ''}${current === i.mode ? ' is-current' : ''}`}
            aria-current={current === i.mode ? 'page' : undefined}
            title={n < 9 ? t('nav.shortcut', { label: i.label, n: n + 1 }) : i.label}
            aria-keyshortcuts={n < 9 ? `Control+${n + 1}` : undefined}
            data-key={n < 9 ? n + 1 : undefined}
            onClick={() => go(i.mode)}
          >
            <Glyph mode={i.mode} />
            <span>{i.label}</span>
          </button>
        </Fragment>
      ))}
    </nav>
  );
}
