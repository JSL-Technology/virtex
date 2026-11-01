import { EntityManager } from 'typeorm';
import { LanguageCode } from '@virteex/shared/types';
import { organizationBaseCurrency } from '../organizations/contracts/base-currency.contract';
import { organizationFiscalIdentity } from '../organizations/contracts/fiscal-identity.contract';

/** Formats an amount for one reader of one company's notice. */
export type AmountFormatter = (amount: number, language: LanguageCode, currencyCode?: string | null) => string;

/**
 * Amounts in a notice the way the company's own screens write them (QA R3-M09 re-verification).
 *
 * Formatted with the reader's language alone, a Dominican notice read «1475,00 DOP» — Spain's
 * Spanish — beside screens that say «RD$1,475.00». The reader's language and the company's country
 * together make the locale (`es-DO`, `en-US`, `pt-BR`), and an amount without a currency of its own
 * (a requisition) is in the books' currency. Read once per notice, not per recipient.
 */
export async function amountFormatterFor(manager: EntityManager, organizationId: string): Promise<AmountFormatter> {
  const [identity, baseCurrency] = await Promise.all([
    organizationFiscalIdentity(manager, organizationId),
    organizationBaseCurrency(manager, organizationId).catch(() => null),
  ]);
  const country = identity?.country ?? null;
  return (amount, language, currencyCode) => formatAmount(amount, language, currencyCode ?? baseCurrency, country);
}

export function formatAmount(
  amount: number,
  language: LanguageCode,
  currencyCode?: string | null,
  country?: string | null,
): string {
  const locale = country ? `${language}-${country}` : language;
  const options: Intl.NumberFormatOptions = currencyCode
    ? { style: 'currency', currency: currencyCode }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  try {
    return new Intl.NumberFormat(locale, options).format(amount);
  } catch {
    // An unknown currency code or locale: the figure, plainly, rather than no notice at all.
    return new Intl.NumberFormat(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  }
}
