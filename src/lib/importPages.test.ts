import { describe, expect, it } from 'vitest';

import { withImportedPages } from './importPages';
import { allEdges, allNodes, newPage } from './pages';
import type { Probe } from '../types/domain';
import type { ProjectDocument, ProjectPage, TopoEdge, TopoNode } from '../state/store';

const node = (id: string, extra: Record<string, unknown> = {}): TopoNode =>
  ({
    id,
    type: 'device',
    position: { x: 0, y: 0 },
    data: { label: id, deviceType: 'router', tags: [], addresses: [], locked: false, maintenance: false, showDetails: true, ...extra },
  }) as never;

const edge = (id: string, source: string, target: string, healthRule: Record<string, unknown> = { type: 'both-endpoints' }): TopoEdge =>
  ({ id, source, target, data: { isPrimary: false, healthRule } }) as never;

const page = (id: string, name: string, nodes: TopoNode[] = [], edges: TopoEdge[] = []): ProjectPage => ({
  ...newPage(name, id),
  nodes,
  edges,
});

const probe = (id: string, objectId: string): Probe =>
  ({ id, projectId: 'other', objectKind: 'node', objectId, name: 'ping', kind: 'icmp', target: '192.0.2.1' }) as never;

let counter = 0;
const newId = () => `new-${++counter}`;

/** This project: one page whose ids are the very ones the other uses. */
const here = (): ProjectDocument => ({
  pages: [page('p1', 'Core', [node('a'), node('b')], [edge('l1', 'a', 'b')])],
  activePageId: 'p1',
  probes: [probe('pr1', 'a')],
  racks: [{ id: 'r1', name: 'Rack A', units: 42 } as never],
});

/** The other project, with clashing ids and names throughout. */
const there = (): ProjectDocument => ({
  pages: [
    page('p1', 'Core', [node('a', { groupId: 'g1', rack: 'rack a' }), node('b', { groupId: 'g1', rack: 'Rack B' })], [
      edge('l1', 'a', 'b', { type: 'named-node-probe', nodeId: 'b', probeId: 'pr2' }),
    ]),
    page('p2', 'Edge', [node('c')], []),
  ],
  activePageId: 'p1',
  probes: [probe('pr1', 'a'), probe('pr2', 'b'), probe('pr3', 'c')],
  stacks: [{ id: 's1', name: 'Pair', technology: 'custom', topology: 'ring', members: [{ nodeId: 'a', number: 1 }, { nodeId: 'b', number: 2 }] } as never],
  racks: [{ id: 'r1', name: 'Rack A', units: 42 } as never, { id: 'r2', name: 'Rack B', units: 24 } as never, { id: 'r3', name: 'Unused', units: 10 } as never],
  customShapes: [{ id: 'shape-1', name: 'x' } as never],
});

describe('withImportedPages', () => {
  it('adds every page of the other project after this one’s, under names not taken, and opens the first', () => {
    const got = withImportedPages(here(), there(), { newId, projectId: 'me' });
    expect(got.doc.pages.map((p) => p.name)).toEqual(['Core', 'Core 2', 'Edge']);
    expect(got.doc.activePageId).toBe(got.doc.pages[1]!.id);
    expect(got).toMatchObject({ pages: 2, devices: 3, links: 1, probes: 3, racks: 1 });
  });

  it('gives everything brought across a fresh id, so nothing is shared with what was here', () => {
    const got = withImportedPages(here(), there(), { newId, projectId: 'me' });
    const nodeIds = allNodes(got.doc).map((n) => n.id);
    const edgeIds = allEdges(got.doc).map((e) => e.id);
    const pageIds = got.doc.pages.map((p) => p.id);
    const probeIds = got.doc.probes.map((p) => p.id);
    for (const list of [nodeIds, edgeIds, pageIds, probeIds]) expect(new Set(list).size).toBe(list.length);
    // What was here is untouched.
    expect(got.doc.pages[0]).toEqual(here().pages[0]);
  });

  it('points links, health rules, probes, groups and stacks at the new ids', () => {
    const got = withImportedPages(here(), there(), { newId, projectId: 'me' });
    const core = got.doc.pages[1]!;
    const [a, b] = core.nodes;
    const link = core.edges[0]!;
    expect([link.source, link.target]).toEqual([a!.id, b!.id]);
    const rule = link.data!.healthRule;
    expect(rule.nodeId).toBe(b!.id);
    const named = got.doc.probes.find((p) => p.id === rule.probeId)!;
    expect(named.objectId).toBe(b!.id);
    // Probes re-keyed to this project, on the new objects.
    const added = got.doc.probes.slice(1);
    expect(added.every((p) => p.projectId === 'me')).toBe(true);
    expect(added.map((p) => p.objectId).sort()).toEqual([a!.id, b!.id, got.doc.pages[2]!.nodes[0]!.id].sort());
    // One group stays one group, under a new id.
    const ga = (a!.data as { groupId?: string }).groupId;
    expect(ga).toBeTruthy();
    expect(ga).not.toBe('g1');
    expect((b!.data as { groupId?: string }).groupId).toBe(ga);
    // The stack follows its members.
    expect(got.doc.stacks).toHaveLength(1);
    expect(got.doc.stacks![0]!.members.map((m) => m.nodeId)).toEqual([a!.id, b!.id]);
  });

  it('adds only the racks the pages use that this project has no rack of that name for', () => {
    const got = withImportedPages(here(), there(), { newId, projectId: 'me' });
    expect(got.doc.racks!.map((r) => r.name)).toEqual(['Rack A', 'Rack B']);
    expect(got.doc.racks![1]!.id).not.toBe('r2');
    expect(got.doc.customShapes!.map((c) => c.id)).toEqual(['shape-1']);
  });

  it('takes only the chosen pages, and leaves a stack behind when not all its members came', () => {
    const got = withImportedPages(here(), there(), { newId, projectId: 'me', pageIds: ['p2'] });
    expect(got.doc.pages.map((p) => p.name)).toEqual(['Core', 'Edge']);
    expect(got.doc.probes).toHaveLength(2);
    expect(got.doc.stacks).toBeUndefined();
    expect(got.doc.racks).toHaveLength(1);
  });

  it('changes nothing when no page is chosen', () => {
    const before = here();
    const got = withImportedPages(before, there(), { newId, projectId: 'me', pageIds: [] });
    expect(got.doc).toBe(before);
    expect(got.pages).toBe(0);
  });
});
