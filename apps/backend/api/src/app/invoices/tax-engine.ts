import { BadRequestException } from '@nestjs/common';
import { COUNTRY_TAX_SCHEMES } from '../localization/fiscal/country-tax-schemes';

/**
 * Server-side tax validation.
 *
 * Line tax rates used to be taken verbatim from the client, so a caller could send any value —
 * including an invented rate or a silent 0 — and the server would bill it. For a country with a
 * defined consumption-tax scheme we now reject any rate that is not one the regime actually levies.
 *
 * Scope note: this enforces that the rate is a REAL rate for the market (e.g. RD ITBIS 18% or
 * exento 0%). Distinguishing a legitimately exempt line from an evasive 0 requires a per-product
 * exempt/taxable classification, which belongs to the catalogue/Inventory module; until that exists
 * both map to the 0% member and are accepted.
 */

const EPSILON = 1e-6;

/** Allowed rates for a country expressed as fractions (0.18, 0), or null when we cannot constrain. */
export function allowedTaxFractions(countryCode: string | null | undefined): number[] | null {
  if (!countryCode) return null;
  const scheme = COUNTRY_TAX_SCHEMES[countryCode.toUpperCase()];
  // Unknown market, or one whose base must be configured per tenant (US, Brazil) → do not constrain.
  if (!scheme || scheme.configurationRequired || scheme.taxes.length === 0) return null;
  return scheme.taxes.map((t) => t.rate / 100);
}

/** Throws when `requestedFraction` is not a rate the country's regime levies. */
export function assertAllowedTaxRate(
  countryCode: string | null | undefined,
  requestedFraction: number,
): void {
  const allowed = allowedTaxFractions(countryCode);
  if (!allowed) return;
  const ok = allowed.some((r) => Math.abs(r - requestedFraction) < EPSILON);
  if (!ok) {
    const list = allowed.map((r) => `${(r * 100).toFixed(0)}%`).join(', ');
    throw new BadRequestException(
      `La tasa de impuesto ${(requestedFraction * 100).toFixed(2)}% no es válida para ${countryCode}. Tasas permitidas: ${list}.`,
    );
  }
}
