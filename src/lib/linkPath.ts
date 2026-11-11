/**
 * A laid-out link as the path that is drawn.
 *
 * `layoutLinks` says where a link's ends are and, for an orthogonal link,
 * where its corners are; this turns that into the SVG path and the point its
 * centre label hangs at. One function for the canvas and the export, so the
 * two cannot draw the same link differently.
 */
import { CORNER_RADIUS, routePath } from './avoidRoute';
import { bezierPath } from './bezierPath';
import { type LinkLayout, type Pt, orthoPoints, squareWaypoints } from './linkLayout';
import type { Side } from './routeLinks';
import { waypointRoute } from './waypointRoute';
import type { LinkData } from '../types/domain';

const BEZIER_SIDE = { t: 'top', r: 'right', b: 'bottom', l: 'left' } as const satisfies Record<Side, string>;

/** Path types drawn as horizontal and vertical runs. */
export function isOrthogonal(kind: LinkData['pathType'] | undefined): boolean {
  const k = kind ?? 'smoothstep';
  return k === 'step' || k === 'smoothstep' || k === 'auto' || k === 'avoid';
}

export interface DrawnLink {
  path: string;
  labelX: number;
  labelY: number;
}

/**
 * The path for a link of `kind` laid out as `lay`. `waypoints` is the route
 * bent in by hand, if any; an orthogonal link keeps it square to its ends.
 */
export function linkPath(
  kind: LinkData['pathType'] | undefined,
  lay: Pick<LinkLayout, 's' | 't' | 'points'>,
  waypoints: readonly Pt[] = [],
  curvature?: number,
): DrawnLink {
  const { s, t } = lay;
  const ortho = isOrthogonal(kind);
  const radius = kind === 'step' ? 0 : CORNER_RADIUS;
  if (waypoints.length > 0) {
    if (ortho) {
      const { path, labelAt } = routePath([s, ...squareWaypoints(s, waypoints, t), t], radius);
      return { path, labelX: labelAt.x, labelY: labelAt.y };
    }
    const { path, labelAt } = waypointRoute(s, [...waypoints], t);
    return { path, labelX: labelAt.x, labelY: labelAt.y };
  }
  if (ortho) {
    const { path, labelAt } = routePath(lay.points ?? orthoPoints(s, t), radius);
    return { path, labelX: labelAt.x, labelY: labelAt.y };
  }
  if (kind === 'straight') {
    return { path: `M${s.x},${s.y}L${t.x},${t.y}`, labelX: (s.x + t.x) / 2, labelY: (s.y + t.y) / 2 };
  }
  const [path, labelX, labelY] = bezierPath({
    sourceX: s.x,
    sourceY: s.y,
    targetX: t.x,
    targetY: t.y,
    sourcePosition: BEZIER_SIDE[s.side],
    targetPosition: BEZIER_SIDE[t.side],
    curvature,
  });
  return { path, labelX, labelY };
}
