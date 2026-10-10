/**
 * The dock's lists, filtered with the shared grammar (`queryGrammar.ts`):
 * a bare word searches the name, target, type, status and tags, as it
 * always did, and `status:down`, `type:router`, `tag:lab`, `site:hq`,
 * `kind:link`, `name:` and `target:` narrow to one, with `-` to exclude.
 */
import type { HealthStatus } from '../types/domain';
import { matchesQuery, splitQuery, type QueryTerm } from './queryGrammar';

const FIELDS: Record<string, string> = {
  status: 'status', state: 'status',
  type: 'type', role: 'type',
  tag: 'tag',
  site: 'site',
  kind: 'kind',
  name: 'name',
  target: 'target', ip: 'target', address: 'target',
};

/** Fields matched whole: `tag:core` must not also find `core-switches`. */
const EXACT = new Set(['status', 'tag', 'kind']);

/** The words a status answers to: the one stored and the one shown. */
const STATUS_WORDS: Record<HealthStatus, string[]> = {
  healthy: ['healthy', 'up'],
  warning: ['warning'],
  down: ['down'],
  unknown: ['unknown', 'not-checked', 'unchecked'],
  disabled: ['disabled'],
  maintenance: ['maintenance'],
};

export interface DockRow {
  kind: 'node' | 'link';
  name: string;
  target: string;
  type: string;
  status: HealthStatus;
  tags: readonly string[];
  site?: string;
}

export function parseDockQuery(query: string): QueryTerm[] {
  return splitQuery(query, (name) => FIELDS[name] ?? null);
}

export function dockRowMatches(row: DockRow, terms: readonly QueryTerm[]): boolean {
  if (terms.length === 0) return true;
  const status = STATUS_WORDS[row.status] ?? [row.status];
  return matchesQuery(terms, {
    text: [row.name, row.target, row.type, ...status, ...row.tags].join(' '),
    values: (field) => {
      switch (field) {
        case 'status':
          return status;
        case 'type':
          return [row.type];
        case 'tag':
          return [...row.tags];
        case 'site':
          return row.site ? [row.site] : [];
        case 'kind':
          return [row.kind, row.kind === 'node' ? 'device' : 'link'];
        case 'name':
          return [row.name];
        case 'target':
          return [row.target];
        default:
          return [];
      }
    },
    exact: (field) => EXACT.has(field),
  });
}
