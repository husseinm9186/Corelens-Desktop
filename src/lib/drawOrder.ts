/**
 * What is drawn over what on the canvas.
 *
 * Objects are stacked in the order the page keeps them, first at the back.
 * Links are one layer, and where that layer sits decides what a box drawn
 * behind a group of devices does: a cable passes behind a device, but it
 * must pass in front of the box the device stands in, or the box hides it.
 *
 * So the drawn shapes at the very back of the stack — every box, circle,
 * cloud or text before the first device or note — go under the links, and
 * everything from that first device on goes over them. A shape brought
 * forward past a device is over the links again, as it is over the device.
 * A zone is a backdrop wherever it is in the order.
 */
import { SHAPE_DEVICE_TYPES } from '../types/domain';

export interface Stackable {
  type?: string;
  data: unknown;
}

const kindOf = (n: Stackable): string | undefined =>
  n.type === 'device' ? (n.data as { deviceType?: string }).deviceType : undefined;

export function stackLevels(nodes: readonly Stackable[]): { nodes: number[]; links: number } {
  // How many shapes lie behind the first thing that is not one.
  let behind = 0;
  for (const n of nodes) {
    const kind = kindOf(n);
    if (kind === 'zone') continue;
    if (kind === undefined || !SHAPE_DEVICE_TYPES.has(kind)) break;
    behind++;
  }
  // With nothing behind them the links stay where they have always been.
  const links = behind === 0 ? 0 : behind + 1;
  let shape = 0;
  let front = false;
  const levels = nodes.map((n, i) => {
    const kind = kindOf(n);
    if (kind === 'zone') return 0;
    if (!front && kind !== undefined && SHAPE_DEVICE_TYPES.has(kind)) return ++shape;
    front = true;
    return links + 1 + i;
  });
  return { nodes: levels, links };
}
