/**
 * The order of the SSH session tabs, which is whoever is working's to choose:
 * the devices of one change kept side by side, whatever order they were
 * opened in.
 *
 * Only the order changes. A session is the same object before and after, so
 * its shell, its transcript and its place in front are untouched.
 *
 * Pure, so the rules are tested without a session.
 */

/** One tab moved onto another's place; the tabs between move along by one.
 *  Dragged to the right it lands after the tab it was dropped on, to the
 *  left before it — either way, where that tab was. An id that is not there,
 *  or a tab dropped on itself, changes nothing and returns the same list. */
export function moveSession<T extends { id: string }>(sessions: T[], movedId: string, ontoId: string): T[] {
  const from = sessions.findIndex((s) => s.id === movedId);
  const to = sessions.findIndex((s) => s.id === ontoId);
  if (from < 0 || to < 0 || from === to) return sessions;
  const next = [...sessions];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** One tab moved a place left (-1) or right (+1) — what the keyboard does.
 *  At either end it stays where it is. */
export function nudgeSession<T extends { id: string }>(sessions: T[], movedId: string, by: -1 | 1): T[] {
  const from = sessions.findIndex((s) => s.id === movedId);
  const onto = sessions[from + by];
  return from < 0 || !onto ? sessions : moveSession(sessions, movedId, onto.id);
}
