/**
 * Up and Down between a table's rows.
 *
 * Every table that answers a click on a row also takes a row into the tab
 * order, and Enter picks it. Getting from one row to the next by Tab alone
 * walks through every row of every table on the way, so the arrows move
 * within the table: Up and Down a row, Home and End to the ends. One
 * listener for the whole window rather than one per table, so a table added
 * later is covered without knowing about it.
 */

/** Where the arrows go from row `at` of `count`, or null for a key that is
 *  not one of them. */
export function nextRow(count: number, at: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return Math.max(0, at - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/** Moves focus between the focusable rows of the table the event came
 *  from. Returns true when it did, so the caller can stop the key. */
export function moveRowFocus(e: KeyboardEvent): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const row = e.target instanceof HTMLElement ? e.target : null;
  if (!row || row.tagName !== 'TR' || !row.hasAttribute('tabindex')) return false;
  const table = row.closest('table');
  if (!table) return false;
  const rows = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr[tabindex]')].filter((r) => r.offsetParent !== null);
  const at = rows.indexOf(row as HTMLTableRowElement);
  if (at < 0) return false;
  const to = nextRow(rows.length, at, e.key);
  if (to === null) return false;
  rows[to]!.focus();
  rows[to]!.scrollIntoView({ block: 'nearest' });
  return true;
}

let installed = false;

/** Installs the one listener; safe to call more than once. */
export function installRowKeys(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // In the capture phase, so it is settled before any other window listener
  // — the canvas's arrows among them — sees the key.
  window.addEventListener('keydown', (e) => {
    if (moveRowFocus(e)) e.preventDefault();
  }, true);
}
