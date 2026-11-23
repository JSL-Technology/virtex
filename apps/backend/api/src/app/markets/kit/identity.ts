import type { IdentityDocumentTypeSpec } from '../contracts';

/** The pseudo-country under which documents with no single issuing state are filed. */
export const SUPRANATIONAL_COUNTRY = 'XX';

/**
 * A passport, issued by every state and identifying a natural person anywhere.
 *
 * Filed under `XX` rather than under every market: a passport's issuing jurisdiction is the
 * traveller's, not the employer's, and a foreign hire is exactly the case where a passport is the
 * document on hand. Resolution considers the tenant's country AND `XX`, so it is offered everywhere
 * without being claimed by anyone. The code each market's e-invoicing gives it is the market's to
 * declare (`MarketIdentity.supranationalRegimeCodes`), not the passport's.
 */
export const PASSPORT: Omit<IdentityDocumentTypeSpec, 'regimeCodes'> = {
  countryCode: SUPRANATIONAL_COUNTRY,
  code: 'PASSPORT',
  labelKey: 'identity_document.passport',
  // Deliberately wide. Passport numbers are issued by some 200 states under no common scheme; any
  // tighter pattern rejects somebody's real document, which is worse than accepting a typo.
  pattern: '^[A-Za-z0-9]{5,20}$',
  checksum: null,
  canonicalForm: 'alphanumeric',
  appliesTo: 'individual',
  requirement: 'optional',
  usedFor: ['payroll', 'invoicing'],
  sortOrder: 900,
};

/** The documents no single state issues, before the markets add their regime codes. */
export const SUPRANATIONAL_DOCUMENTS: readonly Omit<IdentityDocumentTypeSpec, 'regimeCodes'>[] = [PASSPORT];
