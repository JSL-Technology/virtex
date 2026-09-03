import * as Handlebars from 'handlebars';
import type { HelperDeclareSpec, HelperOptions } from 'handlebars';
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_DIRECTION,
  LanguageCode,
  isLanguageCode,
  resolveLocale,
} from '@virteex/shared/types';
import { I18nService } from '../i18n/i18n.service';
import { MAIL_BRAND, MailBrandKey } from './mail-brand';

/**
 * Handlebars helpers that make one template serve every language.
 *
 * ## Why not one template per language
 *
 * The obvious alternative is `password-reset.es.hbs`, `password-reset.en.hbs`,
 * `password-reset.pt.hbs` — ten emails times three languages is thirty files, each with its own
 * copy of the table layout, the dark-mode media queries and the Outlook conditional comments.
 * A change to the button style is then thirty edits, twenty-nine of which are the ones somebody
 * forgets. Worse, nothing checks that the three versions still say the same thing: they drift,
 * silently, exactly the way `en.json` had drifted 376 keys behind `es.json` in the client.
 *
 * One template with `{{t 'KEY'}}` holes gives the same guarantee the interface has: the copy
 * lives in the catalogue, and `messages.parity.spec.ts` refuses to let one language define a
 * string the others do not.
 *
 * ## The helpers
 *
 *     {{t 'MAIL.PASSWORD_RESET.GREETING' name=name}}    translate, with parameters
 *     {{money amount currency}}                          format in the recipient's locale
 *     {{date value}}                                     format in the recipient's locale
 *
 * `language` is read off the template context, which `MailProcessor` always sets, so a template
 * never has to thread it through by hand.
 */
export function mailTemplateHelpers(i18n: I18nService): HelperDeclareSpec {
  /** The language of the mail being rendered, taken from its context. */
  const languageOf = (options: HelperOptions): LanguageCode => {
    const candidate = (options?.data?.root as { language?: unknown } | undefined)?.language;
    return isLanguageCode(candidate) ? candidate : DEFAULT_LANGUAGE;
  };

  const localeOf = (options: HelperOptions): string => {
    const root = options?.data?.root as { language?: unknown; countryCode?: unknown } | undefined;
    const country = typeof root?.countryCode === 'string' ? root.countryCode : null;
    return resolveLocale(languageOf(options), country);
  };

  return {
    /**
     * Translate a key, passing every named argument through as an interpolation parameter.
     *
     *     {{t 'MAIL.INVITATION.BODY' organization=organizationName}}
     *
     * A `params=` argument is spread in as well, for a message whose parameters are decided by
     * the sender rather than by the template — a billing notice renders whichever of four bodies
     * the event calls for, and the template cannot know which values that one needs. Listing them
     * all by hand would also break under Handlebars' `strict: true`, which throws on a missing
     * property rather than rendering nothing.
     */
    t(key: unknown, options: HelperOptions): string {
      if (typeof key !== 'string') return '';
      const { params: bag, ...named } = options?.hash ?? {};
      const params = {
        ...(bag && typeof bag === 'object' ? (bag as Record<string, unknown>) : {}),
        ...named,
      };
      return i18n.translate(key, languageOf(options), params, {
        locale: localeOf(options) as never,
      });
    },

    /**
     * An amount, in the currency it is actually in.
     *
     * A dunning notice that prints pesos with a dollar sign is worse than one that prints
     * nothing, so the currency code is a required argument rather than an assumed default.
     */
    money(value: unknown, currency: unknown, options: HelperOptions): string {
      const amount = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(amount)) return '';
      const code = typeof currency === 'string' && currency ? currency.toUpperCase() : 'USD';
      try {
        return new Intl.NumberFormat(localeOf(options), {
          style: 'currency',
          currency: code,
        }).format(amount);
      } catch {
        // An unknown ISO code must not blank the figure a customer is being asked to pay.
        return `${code} ${amount.toFixed(2)}`;
      }
    },

    /** A date, in the recipient's locale. Rendered in UTC — a mail has no session timezone. */
    date(value: unknown, options: HelperOptions): string {
      const parsed = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(parsed.getTime())) return '';
      return new Intl.DateTimeFormat(localeOf(options), {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(parsed);
    },

    /** The reader's writing direction, for the `<html dir>` attribute. */
    dir(options: HelperOptions): string {
      return LANGUAGE_DIRECTION[languageOf(options)];
    },

    /**
     * Whether the reader writes right to left, for the handful of places a layout has to flip.
     *
     * Used as a subexpression — `{{#if (rtl)}}` — because a bare `{{#if rtl}}` reads as a context
     * lookup, and the context has no such property.
     */
    rtl(options: HelperOptions): boolean {
      return LANGUAGE_DIRECTION[languageOf(options)] === 'rtl';
    },

    /**
     * A brand colour or type stack, by name: `{{brand 'accent'}}`.
     *
     * A helper rather than a context value on purpose. Handlebars runs in strict mode here, so
     * anything read from the context has to be present in every send; a helper always resolves,
     * which means a template can use the palette without `MailService` having to remember to pass
     * it. It also keeps the values in one TypeScript file instead of eleven templates — see
     * `mail-brand.ts` for why an email cannot simply read the design system.
     *
     * Returned unescaped because the type stacks contain single quotes — `'Segoe UI'` — and
     * Handlebars would turn them into `&#x27;` inside a `style` attribute. The values are
     * compile-time constants from this repository, never user input.
     */
    brand(key: unknown): Handlebars.SafeString {
      const value = typeof key === 'string' && key in MAIL_BRAND ? MAIL_BRAND[key as MailBrandKey] : '';
      return new Handlebars.SafeString(value);
    },
  };
}
