/**
 * A drag that follows the pointer until it is let go, and that also ends
 * when the system takes the gesture.
 *
 * A drag that listened for `pointerup` alone never ended when the
 * gesture was cancelled — `pointercancel` from a touchpad gesture, a pen, a
 * touch screen or Windows itself, or the window losing focus mid-drag. Its
 * listeners stayed, so whatever it drew (a link's end, port dots, a snap
 * ring) went on following the pointer until the app was restarted.
 *
 * `done` applies the drag; `cancelled` puts back what it showed and applies
 * nothing. Exactly one of them runs, once. Returns a function that cancels.
 */
export function followPointer(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  move: (ev: PointerEvent) => void,
  done: (ev: PointerEvent) => void,
  cancelled: () => void,
): () => void {
  let over = false;
  const onMove = (e: Event) => {
    if (!over) move(e as PointerEvent);
  };
  const stop = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('blur', onCancel);
  };
  function onUp(e: Event) {
    if (over) return;
    over = true;
    stop();
    done(e as PointerEvent);
  }
  function onCancel() {
    if (over) return;
    over = true;
    stop();
    cancelled();
  }
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onCancel);
  window.addEventListener('blur', onCancel);
  return onCancel;
}
