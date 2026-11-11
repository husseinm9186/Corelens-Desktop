import { useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';

import { dotStreams, pointAlong, subscribeDots } from './dotStreams';

/** Three dots a link, evenly spaced, each with one trailing companion:
 *  smaller, dimmer and slightly behind. Reads as a comet without the cost of
 *  a particle system. The reverse stream of a two-way link is thinner and
 *  dimmer, so it reads as two streams rather than one crowded one. */
const DOTS = 3;
const TRAIL = [
  { r: 3.2, opacity: 0.95, lag: 0 },
  { r: 2.0, opacity: 0.4, lag: 0.1 },
] as const;
/** Past this many links in view, each carries one dot instead of three: the
 *  picture is a field of dots either way, and a third of the drawing. */
const MANY_LINKS = 1500;

/**
 * Every travelling dot on the canvas, drawn in one pass per frame.
 *
 * A child of the React Flow pane, the size of it, in screen pixels: each
 * frame reads the viewport's pan and zoom and places the dots itself, so
 * nothing in React re-renders while they move. It draws only the links in
 * view, runs only while there is a stream to draw, and stops while the window
 * is hidden.
 */
export function LinkDots() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const flow = useStoreApi();

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    let frame = 0;
    let width = 0;
    let height = 0;
    let ratio = 1;
    let drawn = false;
    const at = { x: 0, y: 0 };

    const fit = () => {
      const box = el.getBoundingClientRect();
      ratio = window.devicePixelRatio || 1;
      width = box.width;
      height = box.height;
      el.width = Math.max(1, Math.round(width * ratio));
      el.height = Math.max(1, Math.round(height * ratio));
    };

    const draw = (now: number) => {
      frame = 0;
      const streams = dotStreams();
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (drawn) ctx.clearRect(0, 0, width, height);
      drawn = false;
      if (streams.size === 0 || document.hidden) return; // and no next frame
      const [tx, ty, zoom] = flow.getState().transform;
      // Too small to see: a dot under half a pixel across is nothing but work.
      if (zoom * TRAIL[0].r >= 0.5) {
        // The part of the diagram on screen, with room for a dot's radius.
        const x1 = -tx / zoom - 8;
        const y1 = -ty / zoom - 8;
        const x2 = (width - tx) / zoom + 8;
        const y2 = (height - ty) / zoom + 8;
        const seconds = now / 1000;
        const dots = streams.size > MANY_LINKS ? 1 : DOTS;
        for (const s of streams.values()) {
          if (s.maxX < x1 || s.minX > x2 || s.maxY < y1 || s.minY > y2) continue;
          ctx.fillStyle = s.color;
          const phase = seconds / s.duration;
          for (let i = 0; i < dots; i++) {
            for (const t of TRAIL) {
              const f = phase + i / dots - t.lag;
              const along = f - Math.floor(f);
              if (s.forward && pointAlong(s, along, at)) {
                ctx.globalAlpha = t.opacity;
                ctx.beginPath();
                ctx.arc(at.x * zoom + tx, at.y * zoom + ty, t.r * zoom, 0, Math.PI * 2);
                ctx.fill();
                drawn = true;
              }
              if (s.reverse && pointAlong(s, 1 - along, at)) {
                ctx.globalAlpha = t.opacity * 0.75;
                ctx.beginPath();
                ctx.arc(at.x * zoom + tx, at.y * zoom + ty, t.r * 0.72 * zoom, 0, Math.PI * 2);
                ctx.fill();
                drawn = true;
              }
            }
          }
        }
        ctx.globalAlpha = 1;
      }
      frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    fit();
    const resized = new ResizeObserver(() => {
      fit();
      wake();
    });
    resized.observe(el);
    const unsubscribe = subscribeDots(wake);
    document.addEventListener('visibilitychange', wake);
    wake();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resized.disconnect();
      unsubscribe();
      document.removeEventListener('visibilitychange', wake);
    };
  }, [flow]);

  return <canvas ref={canvas} className="cv-link-dots" data-region="link-dots" aria-hidden />;
}
