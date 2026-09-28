/**
 * Turn a form's raw value into a request body the API can accept.
 *
 * An untouched `<input>` yields `""`. The API treats an optional field that is `""` as a value —
 * and `""` is not a valid e-mail, document type or enum — so sending the form verbatim made the
 * DEFAULT state of the customer and supplier forms impossible to save (QA C-04). This is the one
 * place that decides what a blank means:
 *
 *  - on CREATE, a blank field is simply not sent (`mode: 'create'`);
 *  - on UPDATE, a blank field is sent as `null`, which the API reads as "clear it"
 *    (`mode: 'update'`) — otherwise a user could never remove an e-mail once typed.
 *
 * Strings are trimmed; whitespace-only counts as blank. Fields listed in `keep` are passed through
 * untouched, for the rare field where `""` is itself meaningful.
 */
export function formPayload<T extends Record<string, unknown>>(
  raw: T,
  mode: 'create' | 'update',
  keep: ReadonlyArray<keyof T> = [],
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (keep.includes(key as keyof T)) {
      out[key] = value;
      continue;
    }
    const normalised = typeof value === 'string' ? value.trim() : value;
    const blank = normalised === '' || normalised === undefined;
    if (blank) {
      if (mode === 'update') out[key] = null;
      continue;
    }
    out[key] = normalised;
  }
  return out as Partial<T>;
}
