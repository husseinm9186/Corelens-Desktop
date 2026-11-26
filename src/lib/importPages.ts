/**
 * Another project's pages added to this one.
 *
 * A project exported from somewhere else is a whole document of its own, so
 * every id in it may already be in use here: a device id, a link id, a
 * group, a probe. Everything brought across gets a fresh id, and everything
 * that points at one of those ids — a link's two ends, a named-node health
 * rule, a probe's object, a stack's members, a group — is pointed at the new
 * one, so the pages arrive working and share nothing with what was here.
 *
 * What comes with the pages:
 *   - the probes on what was drawn on them, re-keyed to this project, so the
 *     devices are checked here as they were there;
 *   - stacks whose members all came;
 *   - racks this project has no rack of that name for (a device is in a rack
 *     by its name, so one already here is the one they go in);
 *   - custom shapes this project does not have yet.
 * The rest of the other document (its register, rules, crawl settings,
 * credential defaults) describes that project and stays with it.
 */
import type { Probe } from '../types/domain';
import type { ProjectDocument, ProjectPage, TopoEdge, TopoNode } from '../state/store';
import type { Rack } from './rack';
import type { Stack } from './stacking';

export interface ImportedPages {
  doc: ProjectDocument;
  pages: number;
  devices: number;
  links: number;
  probes: number;
  racks: number;
}

function uniqueName(taken: Set<string>, name: string): string {
  const base = name.trim() || 'Page';
  let candidate = base;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} ${n}`;
    n += 1;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

const sameName = (a: string | undefined, b: string | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/**
 * `source` must already be in this build's shape (through migrateDocument).
 * `pageIds` chooses which of its pages come; every page when absent. The
 * first page brought in becomes the active one.
 */
export function withImportedPages(
  doc: ProjectDocument,
  source: ProjectDocument,
  opts: { newId: () => string; projectId: string; pageIds?: string[] },
): ImportedPages {
  const { newId, projectId } = opts;
  const chosen = source.pages.filter((p) => !opts.pageIds || opts.pageIds.includes(p.id));
  if (chosen.length === 0) return { doc, pages: 0, devices: 0, links: 0, probes: 0, racks: 0 };

  const ids = new Map<string, string>();
  const fresh = (old: string) => {
    let got = ids.get(old);
    if (!got) {
      got = newId();
      ids.set(old, got);
    }
    return got;
  };
  // Groups are per import, not per id: the same group on the other side
  // stays one group here, and never joins a group of this project's.
  const groups = new Map<string, string>();
  const group = (old: unknown) => {
    if (typeof old !== 'string') return old;
    let got = groups.get(old);
    if (!got) {
      got = newId();
      groups.set(old, got);
    }
    return got;
  };

  const taken = new Set(doc.pages.map((p) => p.name.toLowerCase()));
  let devices = 0;
  let links = 0;
  const pages: ProjectPage[] = chosen.map((page) => {
    for (const n of page.nodes) fresh(n.id);
    for (const e of page.edges) fresh(e.id);
    const nodes = page.nodes.map((n) => {
      const data = { ...(n.data as Record<string, unknown>) };
      if (data.groupId !== undefined) data.groupId = group(data.groupId);
      if (n.type === 'device') devices += 1;
      return { ...n, id: ids.get(n.id)!, selected: false, data } as TopoNode;
    });
    const edges = page.edges.map((e) => {
      const data = e.data ? { ...e.data } : e.data;
      if (data && data.healthRule) {
        const rule = { ...data.healthRule };
        if (rule.nodeId) rule.nodeId = ids.get(rule.nodeId) ?? rule.nodeId;
        data.healthRule = rule;
      }
      links += 1;
      return {
        ...e,
        id: ids.get(e.id)!,
        source: ids.get(e.source) ?? e.source,
        target: ids.get(e.target) ?? e.target,
        selected: false,
        data,
      } as TopoEdge;
    });
    return {
      ...page,
      id: newId(),
      name: uniqueName(taken, page.name),
      nodes,
      edges,
      canvas: JSON.parse(JSON.stringify(page.canvas)) as ProjectPage['canvas'],
    };
  });

  // Probes on what came, each with a new id; a link's named-node rule that
  // named one of them follows it.
  const probeIds = new Map<string, string>();
  const probes: Probe[] = [];
  for (const p of source.probes) {
    const objectId = ids.get(p.objectId);
    if (!objectId) continue;
    const id = newId();
    probeIds.set(p.id, id);
    probes.push({ ...p, id, objectId, projectId });
  }
  for (const page of pages) {
    for (const e of page.edges) {
      const rule = e.data?.healthRule;
      if (rule?.probeId && probeIds.has(rule.probeId)) rule.probeId = probeIds.get(rule.probeId)!;
    }
  }

  const stacks: Stack[] = (source.stacks ?? [])
    .filter((s) => s.members.length > 0 && s.members.every((m) => ids.has(m.nodeId)))
    .map((s) => ({ ...s, id: newId(), members: s.members.map((m) => ({ ...m, nodeId: ids.get(m.nodeId)! })) }));

  const usedRacks = new Set(
    pages.flatMap((p) => p.nodes.map((n) => (n.data as { rack?: string }).rack?.trim().toLowerCase()).filter(Boolean)),
  );
  const racks: Rack[] = (source.racks ?? [])
    .filter((r) => usedRacks.has(r.name.trim().toLowerCase()))
    .filter((r) => !(doc.racks ?? []).some((have) => sameName(have.name, r.name)))
    .map((r) => ({ ...r, id: newId() }));

  const haveShapes = new Set((doc.customShapes ?? []).map((c) => c.id));
  const shapes = (source.customShapes ?? []).filter((c) => !haveShapes.has(c.id));

  return {
    doc: {
      ...doc,
      pages: [...doc.pages, ...pages],
      activePageId: pages[0]!.id,
      probes: [...doc.probes, ...probes],
      ...(stacks.length ? { stacks: [...(doc.stacks ?? []), ...stacks] } : {}),
      ...(racks.length ? { racks: [...(doc.racks ?? []), ...racks] } : {}),
      ...(shapes.length ? { customShapes: [...(doc.customShapes ?? []), ...shapes] } : {}),
    },
    pages: pages.length,
    devices,
    links,
    probes: probes.length,
    racks: racks.length,
  };
}
