/**
 * A text field too short for what it holds says the rest when pointed at.
 *
 * A field in a narrow panel shows the start of an address or a name and
 * cuts the rest, and nothing on the screen says what was cut. The browser
 * already has the way to say it, a title; this gives one to a field while
 * it is cut and takes it away once the value fits. A title somebody wrote
 * is never replaced, and a field that hides what is typed says nothing.
 */

/** Marks a title this put there, so it alone is taken away again. */
const MARK = 'data-clipped-title';

/** What decides it, apart from the page: enough of a field to judge. */
export interface FieldLook {
  type: string;
  value: string;
  scrollWidth: number;
  clientWidth: number;
  /** The title it has now, and whether this put it there. */
  title: string | null;
  ours: boolean;
}

/** Field types whose value is text a person may read off the screen. */
const READABLE = new Set(['text', 'search', 'url', 'tel', 'email', 'number', '']);

/**
 * The title a field should have: a string to set, `null` to take ours
 * away, `undefined` to leave whatever is there alone.
 */
export function clippedTitle(f: FieldLook): string | null | undefined {
  if (!READABLE.has(f.type.toLowerCase())) return f.ours ? null : undefined;
  // A title of its own says something chosen; it stays.
  if (f.title !== null && !f.ours) return undefined;
  const cut = f.value !== '' && f.scrollWidth > f.clientWidth + 1;
  if (cut) return f.value === f.title ? undefined : f.value;
  return f.ours ? null : undefined;
}

/** Watches the page: judged when the pointer comes over a field. */
export function watchClippedFields(doc: Document = document): () => void {
  const over = (e: Event) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    const next = clippedTitle({
      type: el.type,
      value: el.value,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      title: el.getAttribute('title'),
      ours: el.hasAttribute(MARK),
    });
    if (next === undefined) return;
    if (next === null) {
      el.removeAttribute('title');
      el.removeAttribute(MARK);
    } else {
      el.setAttribute('title', next);
      el.setAttribute(MARK, '');
    }
  };
  doc.addEventListener('mouseover', over, true);
  return () => doc.removeEventListener('mouseover', over, true);
}
