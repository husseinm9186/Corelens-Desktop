/**
 * A document narrowed to some of its pages — what "This page" in the
 * Export menu means for every export, the tables and the project package
 * included, not only the drawings.
 *
 * What goes with a page: its nodes and links, and the probes that watch
 * them. What stays whole: the racks, templates, rules and the rest, which
 * are the project's rather than a page's. A package made this way imports
 * as a project of those pages.
 */
import type { ProjectDocument } from '../state/store';

export function documentForPages(doc: ProjectDocument, pageIds: string[]): ProjectDocument {
  const keep = new Set(pageIds);
  const pages = doc.pages.filter((p) => keep.has(p.id));
  if (pages.length === 0 || pages.length === doc.pages.length) return doc;
  const objects = new Set<string>();
  for (const page of pages) {
    for (const n of page.nodes) objects.add(n.id);
    for (const e of page.edges) objects.add(e.id);
  }
  return {
    ...doc,
    pages,
    activePageId: keep.has(doc.activePageId) ? doc.activePageId : pages[0]!.id,
    probes: doc.probes.filter((p) => objects.has(p.objectId)),
  };
}
