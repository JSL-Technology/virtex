/**
 * A stored tax identifier written the way its country writes it (QA A-02).
 *
 * Identifiers are stored canonical — `129007988` — because the uniqueness check compares that
 * form. People read them with their separators: a US EIN is `12-9007988`, a Dominican cédula
 * `001-1234567-3`. The country's published example is the mask: when the stored value has as many
 * letters and digits as the example, the example's separators are put back in the same places.
 * Anything else is returned as stored, never guessed at.
 */
export function formatTaxId(value: string | null | undefined, example: string | null | undefined): string {
  const raw = (value ?? '').trim();
  const mask = (example ?? '').trim();
  if (!raw || !mask) return raw;
  const chars = raw.replace(/[^0-9A-Za-zÑñ&]/g, '');
  const slots = mask.replace(/[^0-9A-Za-zÑñ&]/g, '');
  if (chars.length !== slots.length) return raw;
  let i = 0;
  let out = '';
  for (const m of mask) {
    if (/[0-9A-Za-zÑñ&]/.test(m)) out += chars[i++] ?? '';
    else out += m;
  }
  return out;
}
