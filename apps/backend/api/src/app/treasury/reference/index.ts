import { DOMINICAN_BANKS, type ReferenceBank } from './do-banks';

export type { ReferenceBank } from './do-banks';

/**
 * The official bank lists the product ships, by ISO 3166-1 alpha-2 country.
 *
 * A country is added here only with a list taken from its regulator, under the rules
 * `do-banks.ts` states; a country without one offers no import rather than a guessed list.
 */
export const REFERENCE_BANKS: Readonly<Record<string, readonly ReferenceBank[]>> = {
  DO: DOMINICAN_BANKS,
};

export function referenceBanksFor(country: string | null | undefined): readonly ReferenceBank[] {
  return (country && REFERENCE_BANKS[country.toUpperCase()]) || [];
}

/** A BIC that once identified an institution and must no longer be used to route a payment. */
export interface RetiredBic {
  /** The 8-character BIC; any branch code under it is retired with it. */
  bic: string;
  /** What it identified, for the message. */
  institution: string;
  /** The BIC that took its place, when there is one. */
  successor: string | null;
}

/**
 * Retired or misleading BICs that directories still list.
 *
 * A payment sent to one of them bounces at best and is lost at worst, so the catalogue refuses
 * them rather than letting one be typed in by habit or copied from an old directory.
 */
export const RETIRED_BICS: readonly RetiredBic[] = [
  // Banco Múltiple BHD León became Banco BHD (July 2022). Third-party directories still show this
  // passive BIC under the old name; the bank's own BIC is BCBHDOSD.
  { bic: 'BPYMDOS1', institution: 'Banco BHD León', successor: 'BCBHDOSD' },
  // Bellbank was absorbed by JMMB Bank (final approval 2022-10-24).
  { bic: 'BELNDOSD', institution: 'Banco Múltiple Bellbank', successor: 'AHRIDOS2' },
  // Banco Múltiple Bancamérica: no longer on the SB list; last seen in a 2020 SIPA list.
  { bic: 'AHCSDOSD', institution: 'Banco Múltiple Bancamérica', successor: null },
  // Banco Múltiple Activo Dominicana left the system voluntarily in 2023.
  { bic: 'PVDLDOSD', institution: 'Banco Múltiple Activo Dominicana', successor: null },
];

export function retiredBic(bic: string | null | undefined): RetiredBic | null {
  const head = bic?.trim().toUpperCase().slice(0, 8);
  if (!head) return null;
  return RETIRED_BICS.find((retired) => retired.bic === head) ?? null;
}
