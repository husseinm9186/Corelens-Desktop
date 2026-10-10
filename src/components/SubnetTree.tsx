/**
 * The register's left-hand tree: containers and the subnets in them, each
 * with how full it is. Choosing a subnet shows its addresses on the right
 * and puts Allocate and Split & merge on it; the whole row of a container
 * opens and closes it.
 */
import { useMemo, useState } from 'react';

import { t } from '../i18n';
import type { IpamModel } from '../lib/ipam';
import { fillBand, subnetTreeRows } from '../lib/subnetTree';
import { ChromeIcon } from './chromeIcons';

export function SubnetTree({
  model, selected, onSelect,
}: {
  model: IpamModel;
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => subnetTreeRows(model, closed), [model, closed]);
  const toggle = (key: string) =>
    setClosed((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <nav className="cv-subnet-tree" aria-label={t('register.tree')} data-region="subnet-tree">
      <button
        type="button"
        className={`cv-subnet-row is-all${selected === null ? ' is-selected' : ''}`}
        aria-current={selected === null ? 'true' : undefined}
        onClick={() => onSelect(null)}
      >
        <span className="cv-subnet-cidr">{t('register.allSubnets')}</span>
      </button>
      {rows.length === 0 && <p className="cv-help cv-subnet-empty">{t('register.noSubnets')}</p>}
      {rows.map((r) => {
        const pct = r.usable > 0 ? Math.round((r.used / r.usable) * 100) : 0;
        return (
          <button
            key={r.key}
            type="button"
            className={`cv-subnet-row is-${r.kind}${selected === r.key ? ' is-selected' : ''}`}
            style={{ paddingLeft: `${0.61538462 + r.depth * 1.07692308}rem` }}
            data-key={r.key}
            aria-current={selected === r.key ? 'true' : undefined}
            aria-expanded={r.parent ? r.open : undefined}
            title={r.name ? `${r.cidr} · ${r.name}` : r.cidr}
            onClick={() => (r.kind === 'container' ? toggle(r.key) : onSelect(r.key))}
          >
            <span className="cv-subnet-chevron" aria-hidden="true">
              {r.parent && <ChromeIcon name={r.open ? 'chevron-down' : 'chevron-right'} size={12} />}
            </span>
            <span className="cv-subnet-label">
              <span className="cv-subnet-cidr">{r.cidr}</span>
              {r.name && <span className="cv-subnet-name">{r.name}</span>}
            </span>
            <span className="cv-subnet-fill" title={t('register.fill', { used: r.used, usable: r.usable, pct })}>
              <span className={`cv-meter is-${fillBand(r.used, r.usable)}`} aria-hidden="true">
                <i style={{ width: `${Math.min(100, pct)}%` }} />
              </span>
              <span className="cv-subnet-pct">{pct}%</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
