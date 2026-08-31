import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';
import {
  DEFAULT_LANGUAGE,
  LanguageCode,
  LocaleContextContract,
  LANGUAGE_DIRECTION,
  matchLanguage,
  negotiateLanguage,
  resolveLocale,
} from '@virteex/shared/types';

/**
 * Which language THIS request is answered in.
 *
 * ## Why `AsyncLocalStorage` and not a request-scoped provider
 *
 * A request-scoped Nest provider makes every consumer request-scoped too, transitively, which
 * would turn most of the service graph into per-request instantiation for the sake of one string.
 * `AsyncLocalStorage` is a Node core primitive, carries no dependency, and — importantly — is
 * readable from places that have no injector at all: an exception filter, a Handlebars helper,
 * a queue processor that was handed the language explicitly.
 *
 * ## Resolution order, and why it is this one
 *
 * 1. **The signed-in user's stored preference.** The only value that represents a decision.
 * 2. **`Accept-Language`.** What the reader's own software says they read. Never consulted
 *    before the preference: a colleague's borrowed laptop must not change the language of an
 *    account.
 * 3. **The tenant's books language.** For a request with no user and no usable header — a
 *    webhook, a server-to-server call — the organisation's own language beats a global default.
 * 4. **`DEFAULT_LANGUAGE`.**
 *
 * A `null` stored preference is a genuine "never asked", which is why the column has no database
 * default: a default there would be indistinguishable from a choice, and step 2 could never run.
 */

export interface RequestLocale {
  language: LanguageCode;
  /** Present when the request carries a tenant. */
  context: LocaleContextContract | null;
}

const storage = new AsyncLocalStorage<RequestLocale>();

/** The language for the current request, or the default outside one (a cron job, a boot task). */
export function currentLanguage(): LanguageCode {
  return storage.getStore()?.language ?? DEFAULT_LANGUAGE;
}

export function currentLocaleContext(): LocaleContextContract | null {
  return storage.getStore()?.context ?? null;
}

/** Run `fn` with an explicit language. Used by queue processors, which have no HTTP request. */
export function runWithLanguage<T>(language: LanguageCode, fn: () => T): T {
  return storage.run({ language, context: null }, fn);
}

/** Replace the resolved language for the request in flight, once the user is known. */
export function setRequestLocale(locale: Partial<RequestLocale>): void {
  const store = storage.getStore();
  if (!store) return;
  if (locale.language) store.language = locale.language;
  if (locale.context !== undefined) store.context = locale.context;
}

/**
 * Build the locale context sent to the browser with the session.
 *
 * Kept here, beside the resolution rules, so the client and the server cannot end up with two
 * different ideas of what a tenant's locale is.
 */
export function buildLocaleContext(
  language: LanguageCode,
  tenant: {
    countryCode?: string | null;
    currency?: string | null;
    timezone?: string | null;
    booksLanguage?: LanguageCode | null;
  } | null,
): LocaleContextContract {
  const countryCode = (tenant?.countryCode ?? '').toUpperCase() || 'DO';
  return {
    language,
    locale: resolveLocale(language, countryCode),
    direction: LANGUAGE_DIRECTION[language],
    countryCode,
    currency: (tenant?.currency ?? 'USD').toUpperCase(),
    // 'UTC' rather than the server's own zone: a server that happens to run in Frankfurt must
    // not decide what day a Dominican invoice was issued on.
    timezone: tenant?.timezone || 'UTC',
    booksLanguage: tenant?.booksLanguage ?? language,
    // Sunday across every market in the launch set. Declared rather than assumed so a market
    // that starts its week on Monday is a data change.
    firstDayOfWeek: 0,
  };
}

/**
 * Opens the language scope for every request.
 *
 * Runs before the guards, so the language is already resolved when authentication *fails* —
 * which is exactly when the reader most needs the message to be in their own language, and
 * exactly when there is no user to read a preference from.
 */
@Injectable()
export class RequestLocaleMiddleware implements NestMiddleware {
  use(request: { headers?: Record<string, unknown> }, _response: unknown, next: () => void): void {
    const header = request?.headers?.['accept-language'];
    const language =
      negotiateLanguage(typeof header === 'string' ? header : null) ?? DEFAULT_LANGUAGE;

    storage.run({ language, context: null }, next);
  }
}

/**
 * Narrow an arbitrary stored preference to a supported language.
 *
 * Exported so the guard that knows about the user can call it without importing the whole
 * negotiation surface.
 */
export function preferenceLanguage(preferred: string | null | undefined): LanguageCode | null {
  return matchLanguage(preferred);
}
