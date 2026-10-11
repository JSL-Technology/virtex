/**
 * The visitor's likely country, from the languages their browser declares: `es-MX` → `MX`, and a
 * bare `pt` → `BR` through `Intl.Locale.maximize()`.
 *
 * What the product falls back to when it does not know the country yet — before the geolocation
 * answers, or when it fails — instead of assuming one market. Null where the platform cannot tell
 * (a server render, a test environment without `navigator`).
 */
export function visitorRegion(): string | null {
  const languages =
    typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language].filter(Boolean);
  for (const tag of languages) {
    try {
      const LocaleCtor = (Intl as { Locale?: typeof Intl.Locale }).Locale;
      if (!LocaleCtor) break;
      const region = new LocaleCtor(tag).maximize().region;
      if (region && /^[A-Z]{2}$/.test(region)) return region;
    } catch {
      // A malformed tag says nothing about the country; try the next one.
    }
  }
  return null;
}
