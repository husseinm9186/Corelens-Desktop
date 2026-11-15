/**
 * Where a list of imported devices is put down.
 *
 * A sheet has no positions, so its rows go down in a grid under whatever is
 * already on the page. Rows that share a site are kept together — each site
 * a block of its own, in the order the sheet first names it — so a
 * multi-site inventory arrives as its sites rather than as one long grid
 * with the sites interleaved.
 */

export interface SiteBlock {
  site: string;
  /** Positions in the list that was passed in. */
  indexes: number[];
}

export const IMPORT_COLUMNS = 6;
export const IMPORT_STEP_X = 230;
export const IMPORT_STEP_Y = 140;
/** Between one site's block and the next: room for a frame round each. */
export const IMPORT_SITE_GAP = 180;

export function placeBySite(
  rows: readonly { site?: string }[],
  origin: { x: number; y: number },
): { positions: { x: number; y: number }[]; blocks: SiteBlock[] } {
  const order: string[] = [];
  const members = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const site = r.site?.trim() ?? '';
    if (!members.has(site)) {
      members.set(site, []);
      order.push(site);
    }
    members.get(site)!.push(i);
  });
  const positions: { x: number; y: number }[] = rows.map(() => ({ x: origin.x, y: origin.y }));
  let y = origin.y;
  for (const site of order) {
    const indexes = members.get(site)!;
    indexes.forEach((at, i) => {
      positions[at] = { x: origin.x + (i % IMPORT_COLUMNS) * IMPORT_STEP_X, y: y + Math.floor(i / IMPORT_COLUMNS) * IMPORT_STEP_Y };
    });
    y += Math.ceil(indexes.length / IMPORT_COLUMNS) * IMPORT_STEP_Y + (order.length > 1 ? IMPORT_SITE_GAP - IMPORT_STEP_Y + 100 : 0);
  }
  return { positions, blocks: order.filter((s) => s !== '').map((site) => ({ site, indexes: members.get(site)! })) };
}
