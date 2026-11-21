/**
 * One SVG in the label layer that every link's hit band is drawn into.
 *
 * Each band used to bring its own zero-sized SVG, one per link: on a diagram
 * of two hundred links that was two hundred elements doing nothing but hold
 * a path. The bands behave exactly as before — same layer, same width, same
 * handlers — they only share the element that holds them. Where no layer is
 * mounted (a canvas without one), each link falls back to its own.
 */
import { createContext, useContext } from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';

export const EdgeHitHost = createContext<SVGSVGElement | null>(null);

export const useEdgeHitHost = () => useContext(EdgeHitHost);

/** Rendered once inside the ReactFlow; hands its SVG up through `onHost`. */
export function EdgeHitLayer({ onHost }: { onHost: (el: SVGSVGElement | null) => void }) {
  return (
    <EdgeLabelRenderer>
      <svg className="cv-edge-hit" ref={onHost} width="0" height="0" overflow="visible" aria-hidden />
    </EdgeLabelRenderer>
  );
}
