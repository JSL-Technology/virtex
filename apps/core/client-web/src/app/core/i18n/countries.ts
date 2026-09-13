import { Injectable, computed, inject } from '@angular/core';
import { LocaleStore } from './locale.store';

/**
 * Every ISO 3166-1 alpha-2 country code.
 *
 * Codes only, no names: a country's name in the reader's language is something the platform
 * already knows through `Intl.DisplayNames`, and a hand-maintained list of names in three
 * languages would be 750 strings that go stale the next time a country renames itself.
 *
 * Data, not translation — which is why it lives here and not in the catalogue.
 */
export const ISO_COUNTRY_CODES: readonly string[] = Object.freeze([
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS','BT','BV','BW','BY','BZ',
  'CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CW','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','EH','ER','ES','ET',
  'FI','FJ','FK','FM','FO','FR',
  'GA','GB','GD','GE','GF','GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY',
  'HK','HM','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PM','PN','PR','PS','PT','PW','PY',
  'QA',
  'RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ',
  'TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','UM','US','UY','UZ',
  'VA','VC','VE','VG','VI','VN','VU',
  'WF','WS',
  'YE','YT',
  'ZA','ZM','ZW',
]);

/** A country as a picker shows it: the stored code, and the name the reader sees. */
export interface CountryOption {
  code: string;
  name: string;
}

/**
 * Country names, in the reader's language, from the platform.
 *
 * ## Why this exists
 *
 * The customer form offered two countries — the Dominican Republic and the United States —
 * written as two `<option>` elements in the template. The product provisions nineteen markets and
 * a tenant in any of them sells to customers anywhere, so a customer in Spain could not be
 * recorded as being in Spain.
 *
 * The obvious fix is a list of countries with a name per language. `Intl.DisplayNames` is the same
 * data, already on the device, already in every language the browser has, and already correct
 * about the ones that changed name — so the list here is codes, and the names come from CLDR.
 *
 * The tenant-registration form is deliberately NOT this list: a tenant may only be registered in a
 * country the product has a fiscal adapter for, and `CountryService.getSupportedCountries()`
 * answers that question. Which countries you may SELL TO and which you may BE are different
 * questions with different answers.
 */
@Injectable({ providedIn: 'root' })
export class CountryNamesService {
  private readonly store = inject(LocaleStore);

  /**
   * Every country, named in the reader's language, sorted as that language sorts.
   *
   * Sorted with `Intl.Collator` rather than `localeCompare` defaults so that, for example, Spanish
   * puts "Ãlbania" where a Spanish reader looks for it.
   */
  readonly options = computed<CountryOption[]>(() => {
    const locale = this.store.locale();
    const display = this.displayNames(locale);
    const collator = new Intl.Collator(locale, { sensitivity: 'base' });

    return ISO_COUNTRY_CODES.map((code) => ({ code, name: display(code) })).sort((a, b) =>
      collator.compare(a.name, b.name),
    );
  });

  /** One country's name, for showing a stored code outside a picker. */
  nameOf(code: string | null | undefined): string {
    if (!code) return '';
    return this.displayNames(this.store.locale())(code.toUpperCase());
  }

  /**
   * `Intl.DisplayNames` where it exists, the bare code where it does not.
   *
   * Every browser the product supports has it; the fallback is for a server-side render or a test
   * environment with a trimmed ICU, where showing `ES` is honest and throwing is not.
   */
  private displayNames(locale: string): (code: string) => string {
    const DisplayNames = (Intl as { DisplayNames?: typeof Intl.DisplayNames }).DisplayNames;
    if (!DisplayNames) return (code) => code;
    try {
      const names = new DisplayNames([locale], { type: 'region' });
      return (code) => names.of(code) ?? code;
    } catch {
      return (code) => code;
    }
  }
}
