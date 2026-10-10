/**
 * What the start screen works out for itself: the name a mapped network's
 * project is born with, and a sample's thumbnail drawn from its own nodes.
 */
import type { ProjectDocument } from '../state/store';
import { DEVICE_FAMILY, type DeviceFamily } from '../theme';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The name a project started from a seed is given: the seed's /24 when it
 * is an IPv4 address (the subnet a first crawl is usually about), the name
 * itself when it is a hostname, and the date either way — so a second map
 * of the same network the next week is a different project at a glance.
 */
export function mapProjectName(seed: string, when: Date): string {
  const first = seed.split(/[\s,;]+/).find(Boolean) ?? '';
  const m = IPV4.exec(first);
  const where = m && m.slice(1).every((o) => Number(o) <= 255) ? `${m[1]}.${m[2]}.${m[3]}.0/24` : first;
  const date = when.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return where ? `${where} — ${date}` : `New network — ${date}`;
}

/** A seed worth starting from: an address or a name, nothing else. */
export function isSeed(text: string): boolean {
  const first = text.trim();
  if (!first || /\s/.test(first)) return false;
  const m = IPV4.exec(first);
  if (m) return m.slice(1).every((o) => Number(o) <= 255);
  return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(first);
}

export interface Thumb {
  width: number;
  height: number;
  dots: { x: number; y: number; family: DeviceFamily }[];
  lines: { x1: number; y1: number; x2: number; y2: number }[];
}

/**
 * A sample's picture, from the sample itself: each device a dot in its
 * family's colour where it sits, each link a line between two of them,
 * scaled into the card. No artwork — the shape of the network is the
 * picture.
 */
export function sampleThumb(doc: ProjectDocument, width = 280, height = 120, pad = 10): Thumb {
  const page = doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0];
  if (!page) return { width, height, dots: [], lines: [] };
  const devices = page.nodes.filter((n) => n.type === 'device' && (n.data as { deviceType?: string }).deviceType !== 'text' && (n.data as { deviceType?: string }).deviceType !== 'zone');
  if (devices.length === 0) return { width, height, dots: [], lines: [] };
  const centre = (n: (typeof devices)[number]) => ({
    x: n.position.x + (n.width ?? 76) / 2,
    y: n.position.y + (n.height ?? 76) / 2,
  });
  const at = new Map(devices.map((n) => [n.id, centre(n)]));
  const xs = [...at.values()].map((p) => p.x);
  const ys = [...at.values()].map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - minX);
  const spanY = Math.max(1, Math.max(...ys) - minY);
  const k = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  // Centred in the card at the one scale both directions allow.
  const ox = (width - spanX * k) / 2;
  const oy = (height - spanY * k) / 2;
  const place = (p: { x: number; y: number }) => ({ x: Math.round((ox + (p.x - minX) * k) * 10) / 10, y: Math.round((oy + (p.y - minY) * k) * 10) / 10 });
  const dots = devices.map((n) => ({ ...place(at.get(n.id)!), family: DEVICE_FAMILY[(n.data as { deviceType: string }).deviceType] ?? 'physical' }));
  const lines = page.edges
    .filter((e) => at.has(e.source) && at.has(e.target))
    .map((e) => {
      const a = place(at.get(e.source)!);
      const b = place(at.get(e.target)!);
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    });
  return { width, height, dots, lines };
}
