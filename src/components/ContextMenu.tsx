import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Where it can actually be drawn. A menu opened near the bottom of the
  // window used to run off the edge, and the items past the edge were simply
  // unreachable — which is worst for the longest menus, the ones most likely
  // to have the item being looked for.
  const [at, setAt] = useState({ x, y });

  useEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const margin = 8;
    // Lifted rather than flipped: a menu that jumps above the pointer puts a
    // different item under the cursor than the one that was there a moment
    // ago, which is how people click the wrong thing.
    const view = ref.current?.ownerDocument.defaultView ?? window;
    const nextY = Math.max(margin, Math.min(y, view.innerHeight - box.height - margin));
    const nextX = Math.max(margin, Math.min(x, view.innerWidth - box.width - margin));
    if (nextX !== at.x || nextY !== at.y) setAt({ x: nextX, y: nextY });
  }, [x, y, at.x, at.y]);

  // The listeners are put on once and read the newest `onClose` through
  // this. Whoever opens the menu hands in a new function on every render,
  // and a listener replaced while a key is being delivered hears nothing:
  // the canvas's own Escape handler ran first, re-rendered, and the menu's
  // listener was swapped out from under the same keypress.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    // Before anything else hears it, and nothing else does: Escape closes
    // what is on top, and the selection underneath is the next press's.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      e.preventDefault();
      close.current();
    };
    // The window the menu is drawn in, which is not always the main one.
    const view = ref.current?.ownerDocument.defaultView ?? window;
    view.addEventListener('mousedown', away);
    view.addEventListener('keydown', esc, true);
    ref.current?.querySelector('button')?.focus();
    return () => {
      view.removeEventListener('mousedown', away);
      view.removeEventListener('keydown', esc, true);
    };
  }, []);

  return (
    <div className="cv-menu" style={{ left: at.x, top: at.y }} ref={ref} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'is-danger' : ''}
          disabled={item.disabled}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
