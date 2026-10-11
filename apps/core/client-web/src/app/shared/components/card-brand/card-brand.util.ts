/**
 * The payment-network brands the product can draw a logo for.
 *
 * It is deliberately a CLOSED list, not «whatever string Stripe sends». A brand we do not have
 * artwork for has to resolve to `unknown` and get the generic card glyph — never a broken or empty
 * box — so a new network appearing on the provider's side degrades to something legible instead of
 * a hole in the billing screen.
 */
export type CardBrand =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'discover'
  | 'diners'
  | 'jcb'
  | 'unionpay'
  | 'unknown';

/**
 * Every spelling a provider might hand us for the same network, folded to one canonical brand.
 *
 * Stripe already normalises to `visa` / `mastercard` / `amex` / … , but this component is also
 * meant for cards entered by hand elsewhere in the product (POS, customer payment methods), where
 * «American Express», «master card» or «Diners Club International» all turn up. Keeping the
 * aliases here — rather than at each call site — is what lets every screen pass its raw string and
 * get the same logo.
 */
const ALIASES: Readonly<Record<string, CardBrand>> = {
  visa: 'visa',

  mastercard: 'mastercard',
  mc: 'mastercard',
  // Maestro is Mastercard's debit network and ships under the same mark on most cards.
  maestro: 'mastercard',

  amex: 'amex',
  americanexpress: 'amex',

  discover: 'discover',
  // Discover's partner networks report under their own names but carry the Discover acceptance mark.
  diners: 'diners',
  dinersclub: 'diners',
  dinersclubinternational: 'diners',

  jcb: 'jcb',

  unionpay: 'unionpay',
  chinaunionpay: 'unionpay',
  cup: 'unionpay',
};

/**
 * Fold a raw brand string from any source to a {@link CardBrand}.
 *
 * Case, spaces, hyphens and underscores are all stripped before the lookup so `"American Express"`,
 * `"american_express"` and `"AMERICAN-EXPRESS"` land on the same key. Anything unrecognised — or
 * empty — is `unknown`, which is a valid, drawable brand, not an error.
 */
export function normalizeCardBrand(raw: string | null | undefined): CardBrand {
  if (!raw) return 'unknown';
  const key = raw.toLowerCase().replace(/[\s\-_]+/g, '');
  return ALIASES[key] ?? 'unknown';
}

/**
 * The reader-facing name of a brand, for a screen-reader label or a text fallback.
 *
 * These are proper nouns, not UI copy, so they are the same in every language and do NOT go
 * through i18n — translating «Visa» would be wrong, not merely unnecessary. `unknown` is the one
 * exception: it has no name, so it reads as the generic word for the object, «Card».
 */
const LABELS: Readonly<Record<CardBrand, string>> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  unknown: 'Card',
};

export function cardBrandLabel(brand: CardBrand): string {
  return LABELS[brand];
}
