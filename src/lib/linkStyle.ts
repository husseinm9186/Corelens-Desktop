/**
 * How a link is drawn, beyond its health.
 *
 * A network diagram uses line style to mean things the app cannot infer: a
 * dashed line is a tunnel, a dotted one is a planned circuit, a hollow circle
 * at one end is a demarcation point. None of that is health, and a tool that
 * reserves every line property for its own use is a monitor rather than a
 * diagramming tool.
 *
 * So health keeps the colour and the travelling dots, and everything else is
 * the operator's — with 'auto' left as the default so a diagram that has never
 * been touched still reads the way it always did.
 */
import type { HealthStatus, LinkCap, LinkData, LinkKind, LinkLineStyle } from '../types/domain';

/** The dash pattern for a line, or undefined for solid. */
export function dashFor(style: LinkLineStyle | undefined, status: HealthStatus): string | undefined {
  switch (style ?? 'auto') {
    case 'solid':
      return undefined;
    case 'dashed':
      return '10 6';
    case 'dotted':
      return '2 5';
    case 'dash-dot':
      return '12 5 2 5';
    default:
      // The health meaning, which is what this did before the choice existed.
      // Pattern as well as colour, so a projector and a colour-blind eye
      // read the same thing: down dashed, warning dotted.
      return status === 'down'
        ? '10 6'
        : status === 'warning'
          ? '2 4'
          : status === 'disabled'
          ? '2 6'
          : status === 'maintenance'
            ? '12 6'
            : undefined;
  }
}

/** A crawl writes a bundle's members into the link's note. */
const BUNDLE_NOTE = /(\d+) bundled ports: /;

/**
 * What a link is. A choice on the link wins; otherwise what is known about
 * it decides — a tunnel or a layer-3 hop a crawl found, a bundle whose
 * members it read, a circuit marked as WAN — and anything else is a cable.
 */
export function kindOf(data: Partial<Pick<LinkData, 'linkKind' | 'overlay' | 'layer3' | 'notes' | 'cableType'>>): LinkKind {
  if (data.linkKind && data.linkKind !== 'auto') return data.linkKind;
  if (data.overlay) return 'tunnel';
  if (data.layer3) return 'logical';
  if (BUNDLE_NOTE.test(data.notes ?? '')) return 'bundle';
  if (data.cableType === 'wan') return 'transit';
  return 'cable';
}

/** The pattern each kind is drawn with, where it has one. */
const KIND_DASH: Partial<Record<LinkKind, string>> = {
  tunnel: '6 4',
  logical: '1.5 3',
};

export interface LinkStroke {
  dash: string | undefined;
  width: number;
  /** Drawn as two thin lines with the ground showing between them. */
  double: boolean;
}

/**
 * How the line is stroked: its pattern, its weight and whether it is
 * doubled. A pattern chosen on the link wins. Otherwise a tunnel is dashed
 * and a logical adjacency dotted whatever its health, because what it is
 * has to survive when its label is hidden; a cable keeps the health
 * pattern. A bundle is a double line and a transit circuit is heavier,
 * and both still take the health pattern.
 */
export function strokeFor(
  data: Partial<Pick<LinkData, 'linkKind' | 'overlay' | 'layer3' | 'notes' | 'cableType' | 'lineStyle' | 'width'>>,
  status: HealthStatus,
): LinkStroke {
  const kind = kindOf(data);
  const width = data.width ?? 2;
  const chosen = data.lineStyle === 'dashed' || data.lineStyle === 'dotted' || data.lineStyle === 'dash-dot';
  const dash = chosen ? dashFor(data.lineStyle, status) : (KIND_DASH[kind] ?? dashFor(data.lineStyle, status));
  return {
    dash,
    width: kind === 'transit' ? width + 1.25 : width,
    double: kind === 'bundle',
  };
}

/** The two widths a double line is made of: the outer stroke, and the gap
 *  cut out of its middle. Two strokes of 0.6 of the width each, 1.5 widths
 *  apart centre to centre. */
export function doubleWidths(width: number): { outer: number; gap: number } {
  return { outer: width * 2.1, gap: width * 0.9 };
}

/**
 * What to draw at each end.
 *
 * `direction` came first and every existing diagram uses it, so it still
 * decides when nothing more specific has been chosen. An explicit cap wins,
 * including an explicit 'none' on a link whose direction says otherwise.
 */
export function capsFor(data: {
  direction?: string;
  startCap?: LinkCap;
  endCap?: LinkCap;
}, along: -1 | 0 | 1 = 0): { start: LinkCap; end: LinkCap } {
  const direction = data.direction ?? 'forward';
  const fromDirection = {
    start: direction === 'reverse' || direction === 'both' ? 'arrow' : 'none',
    end: direction === 'forward' || direction === 'both' ? 'arrow' : 'none',
  } as { start: LinkCap; end: LinkCap };
  // On a traced path the link also points the way the packet goes.
  if (along === 1) fromDirection.end = 'arrow';
  if (along === -1) fromDirection.start = 'arrow';
  return {
    start: data.startCap ?? fromDirection.start,
    end: data.endCap ?? fromDirection.end,
  };
}

/** Which way a traced path runs along a link: 1 source to target, -1 back,
 *  0 when the link is not a step of it. Only devices next to each other on
 *  the path make a step. */
export function stepAlong(path: readonly string[] | null, source: string, target: string): -1 | 0 | 1 {
  if (!path) return 0;
  const a = path.indexOf(source);
  const b = path.indexOf(target);
  if (a < 0 || b < 0) return 0;
  return b === a + 1 ? 1 : a === b + 1 ? -1 : 0;
}

/** The marker geometry for a cap, in a 12x12 box with the tip at the right. */
export function capPath(cap: LinkCap): { d: string; filled: boolean } | null {
  switch (cap) {
    case 'arrow':
      return { d: 'M0,0 L8,4 L0,8 z', filled: true };
    case 'open-arrow':
      return { d: 'M0,0 L8,4 L0,8', filled: false };
    case 'circle':
      return { d: 'M1,4 a3,3 0 1,0 6,0 a3,3 0 1,0 -6,0', filled: true };
    case 'square':
      return { d: 'M1,1 L7,1 L7,7 L1,7 z', filled: true };
    case 'diamond':
      return { d: 'M0,4 L4,1 L8,4 L4,7 z', filled: true };
    default:
      return null;
  }
}
