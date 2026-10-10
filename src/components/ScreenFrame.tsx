/**
 * The one frame every full screen uses — the address register, Racks,
 * Inventory, Settings.
 *
 * A 36 px sub-header with a breadcrumb whose first crumb is the way back to
 * the diagram, the screen's own tabs underlined on the same row, and
 * anything it does to the whole screen at the right. Below it a tree down
 * the left where the screen has one, and the content, held to a width a
 * table can be read across unless the screen is a drawing that wants the
 * room. The rail is how one screen leads to another; Escape, or the
 * breadcrumb, goes back to the diagram.
 */
import { useEffect, type ReactNode } from 'react';

import { t } from '../i18n';

export interface ScreenTab<T extends string> {
  id: T;
  label: string;
}

/** The sub-header alone, for a screen with a body of its own — the guide. */
export function ScreenHead<T extends string>({
  title, tabs, active, onTab, actions, onClose,
}: {
  title: string;
  tabs?: readonly ScreenTab<T>[];
  active?: T;
  onTab?: (id: T) => void;
  actions?: ReactNode;
  onClose: () => void;
}) {
  // Escape goes back to the diagram, unless something on the screen took it
  // first: a field being typed in, a menu, a dialog over the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (document.querySelector('.cv-modal, [role="dialog"], details[open]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="cv-screen-head">
      <nav className="cv-screen-crumbs" aria-label={t('screen.crumbs')}>
        <button type="button" className="cv-crumb-home" onClick={onClose} title={t('screen.backHint')}>
          {t('screen.diagram')}
        </button>
        <span className="cv-crumb-sep" aria-hidden="true">›</span>
        <h1 className="cv-screen-title" aria-current="page">{title}</h1>
      </nav>
      {tabs && tabs.length > 0 && (
        <div
          className="cv-tabs cv-screen-tabs cv-register-tabs"
          role="tablist"
          aria-label={title}
          onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            const all = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
            const at = all.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1
              : (at + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
            e.preventDefault();
            all[next]?.focus();
            all[next]?.click();
          }}
        >
          {tabs.map((tab) => (
            <button key={tab.id} type="button" role="tab" aria-selected={active === tab.id}
              tabIndex={active === tab.id ? 0 : -1}
              className={active === tab.id ? 'is-active' : ''} onClick={() => onTab?.(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {actions && <div className="cv-screen-actions">{actions}</div>}
    </div>
  );
}

export function ScreenFrame<T extends string>({
  title, className = '', region, tabs, active, onTab, actions, tree, wide, onClose, children,
}: {
  title: string;
  className?: string;
  region: string;
  tabs?: readonly ScreenTab<T>[];
  active?: T;
  onTab?: (id: T) => void;
  actions?: ReactNode;
  tree?: ReactNode;
  /** A drawing — the racks — takes the whole width. */
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`cv-register cv-screen ${className}`} data-region={region}>
      <ScreenHead title={title} tabs={tabs} active={active} onTab={onTab} actions={actions} onClose={onClose} />
      <div className={`cv-register-body cv-screen-body${tree ? ' has-tree' : ''}${wide ? ' is-wide' : ''}`}>
        {tree && <aside className="cv-screen-tree">{tree}</aside>}
        <div className="cv-screen-content">{children}</div>
      </div>
    </div>
  );
}
