/**
 * Turning what an operator typed into something safe to put in a `LIKE`.
 *
 * ## Why this is not four copies of one line
 *
 * Because it was about to be. Every entity picker needs the same two decisions — how to build the
 * pattern and how far to trust the caller's page size — and a decision copied four times is four
 * places for it to drift. The escaping in particular is the kind of thing that gets omitted in the
 * fourth copy and nobody notices, because the symptom is a search that quietly returns everything.
 */

/**
 * A `%term%` pattern with the wildcards in the term itself neutralised.
 *
 * `%`, `_` and `\` mean something to `LIKE`: unescaped, a search for `100%` matches every row in
 * the table and a search for `a_b` matches `axb`. Postgres takes a backslash as the default escape
 * character, so doubling it is all that is needed.
 *
 * Returns null for a blank term, because "the operator typed nothing" and "the operator typed
 * something that matches nothing" are different questions and only the second deserves a `WHERE`.
 */
export function likeTerm(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`;
}

/**
 * How many rows to return, within reason.
 *
 * Clamped rather than trusted: a client asking for a million rows is asking the database to do
 * something no screen can use, and a client asking for zero is asking for a list that looks empty.
 * Undefined means "no cap", which is what the callers that predate the pickers still expect.
 */
export function clampLimit(raw: string | number | null | undefined, max = 200): number | undefined {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(Math.trunc(parsed), 1), max);
}
