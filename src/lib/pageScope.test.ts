import { describe, expect, it } from 'vitest';

import type { ProjectDocument } from '../state/store';
import { documentForPages } from './pageScope';

const node = (id: string) => ({ id, type: 'device', position: { x: 0, y: 0 }, data: { label: id } });
const probe = (id: string, objectId: string, objectKind: 'node' | 'edge' = 'node') => ({ id, objectId, objectKind, kind: 'icmp' });
const doc = {
  activePageId: 'p2',
  pages: [
    { id: 'p1', name: 'Core', canvas: {}, nodes: [node('a'), node('b')], edges: [{ id: 'ab', source: 'a', target: 'b' }] },
    { id: 'p2', name: 'Branch', canvas: {}, nodes: [node('c')], edges: [] },
  ],
  probes: [probe('pa', 'a'), probe('pab', 'ab', 'edge'), probe('pc', 'c')],
  racks: [{ id: 'r1', name: 'R01' }],
} as unknown as ProjectDocument;

describe('a document narrowed to some pages', () => {
  it('keeps those pages, their probes, and the project-wide rest', () => {
    const one = documentForPages(doc, ['p1']);
    expect(one.pages.map((p) => p.id)).toEqual(['p1']);
    expect(one.probes.map((p) => p.id)).toEqual(['pa', 'pab']);
    expect(one.activePageId).toBe('p1');
    expect(one.racks).toEqual(doc.racks);
    expect(doc.pages).toHaveLength(2);
  });

  it('keeps the active page when it is among them', () => {
    expect(documentForPages(doc, ['p2']).activePageId).toBe('p2');
  });

  it('is the document itself for every page or for none', () => {
    expect(documentForPages(doc, ['p1', 'p2'])).toBe(doc);
    expect(documentForPages(doc, ['nope'])).toBe(doc);
  });
});
