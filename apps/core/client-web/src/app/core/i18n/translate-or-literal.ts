import { TranslateService } from '@ngx-translate/core';

/**
 * Translate a string that MAY be a key, and show it as it is when it is not.
 *
 * Some values arrive from the server without the client knowing whether they are a catalogue key
 * or already a sentence: a plan description, a Stripe subscription status, a fiscal document type
 * from a localisation pack a tenant added itself. The rule is the same in every case — translate
 * what the catalogue knows, print what it does not, and never show the reader a raw key.
 *
 * ## Why the comparison is not just `result === key`
 *
 * `instant` hands a missing key to `VirtexMissingTranslationHandler`, which returns the key itself
 * in production and `[[KEY]]` in development. Comparing only against the key therefore misses the
 * development case, and the screen shows `[[BILLING.PLANS.PRO.DESCRIPTION]]` — which is exactly
 * the bug this helper exists to stop repeating, once per call site.
 */
export function translateOrLiteral(
  translate: TranslateService,
  value: string | null | undefined,
  params?: Record<string, unknown>,
  /** What to show when the catalogue has no entry. Defaults to `value` itself. */
  fallback?: string,
): string {
  if (!value) return fallback ?? '';
  const translated = translate.instant(value, params);
  const missing = translated === value || translated === `[[${value}]]`;
  return missing ? (fallback ?? value) : translated;
}
