/**
 * The i18n runtime both browser applications share.
 *
 * ## Why this is a library and not a folder in the web client
 *
 * It was a folder in the web client, and the POS terminal — a separate Angular application with its
 * own bundle — therefore had none of it. That app shipped 100 % hard-coded English text in a product
 * whose default language is Spanish and whose pilot market is the Dominican Republic, and it
 * formatted money with `Intl.NumberFormat(undefined, …)`, which is the BROWSER's locale rather than
 * the tenant's: a till running Windows in English printed Dominican pesos with US grouping.
 *
 * Everything here is application-agnostic on purpose. `LocaleStore` injects nothing but the
 * platform, `FormatService` injects only `LocaleStore`, and the catalogue each app loads is its own
 * — generated from `libs/shared/locales` by `tools/i18n/build-catalogues.mjs`.
 */
export * from './lib/locale.store';
export * from './lib/format.service';
export * from './lib/format.pipes';
export * from './lib/localized-name';
export * from './lib/localized-name.pipe';
export * from './lib/translate-store';
export * from './lib/missing-translation.handler';
export * from './lib/translate-or-literal';
export * from './lib/regional-catalogue';
export * from './lib/error-key';
