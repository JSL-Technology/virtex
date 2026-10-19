/**
 * The legal documents a customer accepts, and which edition of each is in force.
 *
 * ## Why this is shared between the browser and the API
 *
 * Signup used to finish with a "I agree to the Terms and the Privacy policy" box that linked to
 * pages that did not exist, was not required, and whose answer never left the browser (QA C-07,
 * C-08). Consent that cannot be shown later — WHICH text, WHEN, from WHERE — is not consent anyone
 * can rely on, under GDPR art. 7(1), LGPD art. 8 §2 or the CCPA's notice-at-collection rule.
 *
 * The version is therefore one value, here: the pages print it, the signup form sends it, and the
 * server refuses a signup that accepted any other edition. Publishing a new edition is a change to
 * this file plus the text; a client still holding the old one is told to reload rather than
 * silently recording acceptance of a text the person never saw.
 *
 * `version` is the effective date in ISO form on purpose: it sorts, it is unambiguous across the
 * three languages the pages are written in, and it is what a reader is asked "which version did
 * you accept?" about.
 */
export type LegalDocumentId = 'terms' | 'privacy' | 'security';

export interface LegalDocumentEdition {
  /** Identifier recorded with every acceptance. */
  readonly version: string;
  /** From when this edition governs, ISO 8601 (date only). */
  readonly effectiveDate: string;
}

export const LEGAL_DOCUMENTS: Readonly<Record<LegalDocumentId, LegalDocumentEdition>> = Object.freeze({
  terms: { version: '2026-10-12', effectiveDate: '2026-10-12' },
  privacy: { version: '2026-10-12', effectiveDate: '2026-10-12' },
  security: { version: '2026-10-12', effectiveDate: '2026-10-12' },
});

/** The two documents a signup must accept, in the order they are recorded. */
export const SIGNUP_CONSENT_DOCUMENTS: readonly LegalDocumentId[] = Object.freeze(['terms', 'privacy']);
