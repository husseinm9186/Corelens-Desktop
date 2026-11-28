/**
 * Pages: more than one independent drawing in one project.
 *
 * A tab strip along the bottom of the canvas, the way Lucidchart does it —
 * each tab is a completely separate canvas, not a filter over a shared one
 * (that is what Views/Layers already does).
 *
 * A tab is a tab, not a text field: a click opens its page, a drag moves
 * it, and its name becomes a field only while it is being renamed (a
 * double-click, F2, or Rename in its menu). The name is kept as it was
 * typed, spaces and all, when Enter is pressed or something else is; it
 * used to be written to the page on every key, trimmed each time, which
 * took a space away the moment it was typed.
 *
 * The list of all pages and Add a page sit at the ends and do not scroll
 * with the tabs between them.
 */
import { useEffect, useRef, useState } from 'react';

import { useStore } from '../state/store';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { PageNavigator } from './PageNavigator';
import { t } from '../i18n';

import { ChromeIcon } from './chromeIcons';

/** How far the pointer goes before a press on a tab is a drag. */
const DRAG_AFTER = 5;

export function PageTabs() {
  // The pages and which is active, not the whole document.
  const pages = useStore((s) => s.doc.pages);
  const activePageId = useStore((s) => s.doc.activePageId);
  const addPage = useStore((s) => s.addPage);
  const removePage = useStore((s) => s.removePage);
  const renamePage = useStore((s) => s.renamePage);
  const duplicatePage = useStore((s) => s.duplicatePage);
  const reorderPages = useStore((s) => s.reorderPages);
  const setActivePage = useStore((s) => s.setActivePage);

  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  // The page being renamed and what has been typed so far.
  const [renaming, setRenamingState] = useState<{ id: string; draft: string } | null>(null);
  // The same, readable where a rename ends: Enter takes the field away,
  // which the field then reports as losing the keyboard, and the name is
  // kept once.
  const renamingNow = useRef<{ id: string; draft: string } | null>(null);
  const setRenaming = (next: { id: string; draft: string } | null) => {
    renamingNow.current = next;
    setRenamingState(next);
  };
  // A tab being dragged: where it was and the place it would take.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const press = useRef<{ index: number; x: number; moved: boolean } | null>(null);
  // A drag ends in a click on the tab it started on; that click is not one.
  const dragged = useRef(false);
  // The tab the keyboard goes back to once a rename or a move is done.
  const refocus = useRef<string | null>(null);

  // The navigator closes on a press anywhere outside it.
  useEffect(() => {
    if (!navOpen) return;
    const away = (e: PointerEvent) => {
      if (!stripRef.current?.contains(e.target as Node)) setNavOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [navOpen]);

  const tabOf = (id: string) => scrollRef.current?.querySelector<HTMLElement>(`[data-page="${CSS.escape(id)}"]`) ?? null;

  // The open page's tab is always in the strip: a page chosen from the
  // navigator, a search or a link may be one whose tab is off its end.
  useEffect(() => {
    const strip = scrollRef.current;
    const tab = strip?.querySelector<HTMLElement>('.cv-page-tab.is-active');
    if (!strip || !tab) return;
    const left = tab.offsetLeft - strip.offsetLeft, right = left + tab.offsetWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }, [activePageId, pages.length, renaming?.id]);

  // The keyboard follows what it did: the tab gone to, moved or renamed.
  useEffect(() => {
    const id = refocus.current;
    if (!id || renaming) return;
    refocus.current = null;
    tabOf(id)?.focus();
  });

  const startRename = (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    setActivePage(id);
    setRenaming({ id, draft: page.name });
  };
  /** Keeps what was typed, or with `keep` false leaves the name as it was. */
  const endRename = (keep: boolean, backToTab: boolean) => {
    const now = renamingNow.current;
    if (!now) return;
    setRenaming(null);
    // A blank name is refused by the store; the page keeps its own.
    if (keep) renamePage(now.id, now.draft);
    if (backToTab) refocus.current = now.id;
  };

  const move = (from: number, to: number) => {
    const page = pages[from];
    if (!page || to < 0 || to >= pages.length || to === from) return;
    reorderPages(from, to);
    refocus.current = page.id;
  };

  const menuItems = (id: string): MenuItem[] => {
    const at = pages.findIndex((p) => p.id === id);
    return [
      { label: t('pageTabs.rename'), onSelect: () => startRename(id) },
      { label: t('pageTabs.duplicate'), onSelect: () => duplicatePage(id) },
      { label: t('pageTabs.moveLeft'), disabled: at <= 0, onSelect: () => move(at, at - 1) },
      { label: t('pageTabs.moveRight'), disabled: at < 0 || at >= pages.length - 1, onSelect: () => move(at, at + 1) },
      { label: t('pageTabs.delete'), danger: true, disabled: pages.length <= 1, onSelect: () => removePage(id) },
    ];
  };

  /** The place a dragged tab would take with the pointer at `x`: how many
   *  of the other tabs have their middle to the left of it. */
  const placeAt = (x: number, from: number) => {
    const tabs = [...(scrollRef.current?.querySelectorAll<HTMLElement>('.cv-page-tab') ?? [])];
    let to = 0;
    tabs.forEach((el, i) => {
      if (i === from) return;
      const r = el.getBoundingClientRect();
      if (r.left + r.width / 2 < x) to += 1;
    });
    return to;
  };

  return (
    <div ref={stripRef} className="cv-page-tabs">
      <button
        type="button"
        className={`cv-page-nav-toggle${navOpen ? ' is-on' : ''}`}
        title={t('pageTabs.allPages')}
        aria-label={t('pageTabs.allPages')}
        aria-expanded={navOpen}
        onClick={() => setNavOpen((o) => !o)}
      >
        <ChromeIcon name="menu" size={14} />
      </button>
      {navOpen && <PageNavigator onClose={() => setNavOpen(false)} />}
      <div
        ref={scrollRef}
        className="cv-page-tabs-scroll"
        role="tablist"
        aria-label={t('pageTabs.pages')}
        // A mouse has one wheel, and the strip runs sideways.
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
        }}
      >
        {pages.map((p, i) => {
          const active = p.id === activePageId;
          const editing = renaming?.id === p.id;
          const drop = drag && drag.to !== drag.from && drag.to === i ? (drag.to > drag.from ? ' is-drop-after' : ' is-drop-before') : '';
          return (
            <div
              key={p.id}
              data-page={p.id}
              className={`cv-page-tab${active ? ' is-active' : ''}${editing ? ' is-renaming' : ''}${drag?.from === i ? ' is-dragging' : ''}${drop}`}
              role="tab"
              aria-selected={active}
              // One stop for the Tab key, on the open page; the arrows go between them.
              tabIndex={active ? 0 : -1}
              // The whole name, for a tab with room only for the start of it.
              title={p.name}
              // Room for the start of the name however many pages there are;
              // past that the strip scrolls rather than cut every tab to nothing.
              style={{ minWidth: `calc(${Math.min([...p.name].length, 14)}ch + 1.4rem)` }}
              onClick={() => {
                if (dragged.current) {
                  dragged.current = false;
                  return;
                }
                if (!editing) setActivePage(p.id);
              }}
              onDoubleClick={() => {
                if (!editing) startRename(p.id);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, id: p.id });
              }}
              onPointerDown={(e) => {
                if (e.button !== 0 || editing) return;
                dragged.current = false;
                press.current = { index: i, x: e.clientX, moved: false };
                // The pointer is this tab's until it is let go, wherever it goes.
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const held = press.current;
                if (!held || held.index !== i) return;
                if (!held.moved && Math.abs(e.clientX - held.x) < DRAG_AFTER) return;
                held.moved = true;
                // Near an end of the strip, it moves along under the tab.
                const strip = scrollRef.current;
                if (strip) {
                  const box = strip.getBoundingClientRect();
                  if (e.clientX < box.left + 28) strip.scrollLeft -= 14;
                  else if (e.clientX > box.right - 28) strip.scrollLeft += 14;
                }
                const to = placeAt(e.clientX, i);
                setDrag((now) => (now?.from === i && now.to === to ? now : { from: i, to }));
              }}
              onPointerUp={(e) => {
                const held = press.current;
                press.current = null;
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                if (!held?.moved) return;
                dragged.current = true;
                const to = placeAt(e.clientX, held.index);
                setDrag(null);
                if (to !== held.index) reorderPages(held.index, to);
              }}
              onPointerCancel={() => {
                press.current = null;
                setDrag(null);
              }}
              onKeyDown={(e) => {
                if (editing) return;
                const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
                if (step) {
                  e.preventDefault();
                  e.stopPropagation();
                  const to = i + step;
                  if (to < 0 || to >= pages.length) return;
                  if (e.altKey) move(i, to);
                  else {
                    setActivePage(pages[to]!.id);
                    refocus.current = pages[to]!.id;
                  }
                } else if (e.key === 'Home' || e.key === 'End') {
                  e.preventDefault();
                  e.stopPropagation();
                  const to = pages[e.key === 'Home' ? 0 : pages.length - 1]!;
                  setActivePage(to.id);
                  refocus.current = to.id;
                } else if (e.key === 'F2') {
                  e.preventDefault();
                  e.stopPropagation();
                  startRename(p.id);
                } else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setActivePage(p.id);
                } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.left, y: r.top, id: p.id });
                }
              }}
            >
              {editing ? (
                // The name's own width, which a text field does not have:
                // the same text, unseen, gives the field its size.
                <span className="cv-page-tab-fit" data-value={renaming.draft}>
                  <input
                    className="cv-page-tab-rename"
                    aria-label={t('pageTabs.pageName')}
                    value={renaming.draft}
                    spellCheck={false}
                    ref={(el) => {
                      // Once, when it appears: the whole name chosen, to be typed over.
                      if (el && el.ownerDocument.activeElement !== el) {
                        el.focus();
                        el.select();
                      }
                    }}
                    onChange={(e) => setRenaming({ id: p.id, draft: e.target.value })}
                    onKeyDown={(e) => {
                      // Typing here is typing: no key reaches the canvas's own.
                      e.stopPropagation();
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        endRename(true, true);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        endRename(false, true);
                      }
                    }}
                    // Something else pressed: what was typed is the name.
                    onBlur={() => endRename(true, false)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                  />
                </span>
              ) : (
                <span className="cv-page-tab-name">{p.name}</span>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="cv-page-tab-add"
        title={t('pageTabs.addAPage')}
        aria-label={t('pageTabs.addAPage')}
        onClick={() => addPage('Page')}
      >
        +
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
