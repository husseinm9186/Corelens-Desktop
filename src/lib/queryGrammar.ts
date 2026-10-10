/**
 * One way of typing a filter, wherever there is a box to type it in: the
 * address register, the dock's lists and the command palette.
 *
 * **The grammar is what people already type.** Bare words match the obvious
 * text; `field:value` narrows to one field; a leading `-` excludes; quotes
 * keep a value with a space in it whole. Every term must match, because that
 * is what a person means by typing two of them.
 *
 *     core                 anything mentioning "core"
 *     status:down          only what is down
 *     type:router -tag:lab routers, except those tagged lab
 *     name:"core sw"       a value with a space in it
 *
 * **An unknown field is a word, not an error.** Someone typing `printer:2f`
 * means to search for that text, and refusing the whole query because
 * `printer` is not a field would be the least useful possible response.
 *
 * Each place says which fields it has and what they read; the splitting,
 * the negation and the every-term-must-match rule are the same everywhere.
 */

export interface QueryTerm {
  /** The field named before the colon, as the place resolved it; null for a
   *  bare word. */
  field: string | null;
  value: string;
  negated: boolean;
}

/**
 * Splits a query into terms. `fieldOf` turns a typed field name (lower-case)
 * into the field it means, or null when the place has no such field — and
 * then the whole word, colon and all, is searched as text.
 */
export function splitQuery(query: string, fieldOf: (name: string) => string | null): QueryTerm[] {
  const terms: QueryTerm[] = [];
  const words = query.match(/-?(?:[a-zA-Z][\w-]*:)?"[^"]*"|\S+/g) ?? [];
  for (const raw of words) {
    let word = raw;
    const negated = word.startsWith('-') && word.length > 1;
    if (negated) word = word.slice(1);
    const colon = word.indexOf(':');
    let field: string | null = null;
    let value = word;
    if (colon > 0) {
      const resolved = fieldOf(word.slice(0, colon).toLowerCase());
      if (resolved) {
        field = resolved;
        value = word.slice(colon + 1);
      }
    }
    value = value.replace(/^"|"$/g, '').trim().toLowerCase();
    if (value === '') continue;
    terms.push({ field, value, negated });
  }
  return terms;
}

/** What a place exposes for matching one thing. */
export interface QuerySubject {
  /** Everything a bare word searches, already lower-cased or not. */
  text: string;
  /** The values of a field, for `field:value` terms. */
  values: (field: string) => readonly string[];
  /** Whether a field is matched whole rather than by substring. */
  exact?: (field: string) => boolean;
}

/** Whether one term matches, before negation is applied. */
export function termHits(term: QueryTerm, subject: QuerySubject): boolean {
  if (term.field === null) return subject.text.toLowerCase().includes(term.value);
  const values = subject.values(term.field).map((v) => v.toLowerCase());
  return subject.exact?.(term.field) ? values.includes(term.value) : values.some((v) => v.includes(term.value));
}

/** Whether every term holds. An empty query matches everything. */
export function matchesQuery(terms: readonly QueryTerm[], subject: QuerySubject): boolean {
  return terms.every((t) => termHits(t, subject) !== t.negated);
}

/** The words of a query that are plain text, kept in order — for a place
 *  that ranks by how well the text matches as well as filtering. */
export function plainText(terms: readonly QueryTerm[]): string {
  return terms.filter((t) => t.field === null && !t.negated).map((t) => t.value).join(' ');
}
