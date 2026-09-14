/**
 * Applying a country's wording on top of the neutral catalogue.
 *
 * ## Why a patch and not a catalogue per country
 *
 * `es-DO` and `es-MX` read the same catalogue and do not use the same words: the year-end bonus is a
 * *regalía pascual* in Santo Domingo and an *aguinaldo* in Monterrey; the tax identifier is an RNC in
 * one and an RFC in the other. Nineteen keys out of 5.716 differ for the Dominican Republic.
 *
 * A full catalogue per market would multiply the translation work by the number of countries to
 * express that, and — worse — a country would fall silently behind the base the moment a key was
 * added, because nothing would say the new key had never been reviewed for it. A patch cannot fall
 * behind: what it does not mention, it does not change.
 */

export type Catalogue = Record<string, string>;

/** Every locale's patch, as `tools/i18n/build-catalogues.mjs` emits it. */
export type RegionalCatalogue = Record<string, Catalogue>;

/**
 * The base catalogue with one locale's wording applied.
 *
 * Returns a NEW object rather than mutating: switching from `es-DO` to `es-MX` must not leave the
 * Dominican wording standing on the keys Mexico does not override.
 *
 * A patch entry naming a key the catalogue does not have is ignored rather than added. Adding it
 * would make a stale override look like a working one, and `verify-catalogues.mjs` is what should
 * report it — at build time, where somebody can fix it.
 */
export function applyRegionalCatalogue(
  base: Catalogue,
  regional: RegionalCatalogue,
  locale: string | null | undefined,
): Catalogue {
  const patch = locale ? regional[locale] : undefined;
  if (!patch) return base;

  const merged: Catalogue = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key in merged) merged[key] = value;
  }
  return merged;
}
