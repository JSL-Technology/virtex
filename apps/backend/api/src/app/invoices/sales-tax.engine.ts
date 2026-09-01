import { BadRequestException } from '@nestjs/common';
import { COUNTRY_TAX_SCHEMES } from '../localization/fiscal/country-tax-schemes';
import { TaxTreatment } from './entities/invoice-line-item.entity';
import { minorUnitsFor } from '../currencies/currency-catalogue';
import { BadRequestError } from '../i18n/localized.exception';

/**
 * The arithmetic of a sales document, in one place.
 *
 * ## Why this replaces the previous `tax-engine.ts`
 *
 * The old engine did one thing: reject a line whose tax rate was not one the country levies. That
 * left three real defects standing.
 *
 * 1. **The rate still came from the client.** Checking a rate against a list cannot tell an exempt
 *    book from an evasive zero on a taxable good. The rate is now derived from the catalogue and
 *    the request may only select among treatments the item allows.
 * 2. **It knew nothing about the Dominican reduced rate.** `COUNTRY_TAX_SCHEMES.DO` lists 18 % and
 *    0 %, so a 16 % line — the rate the DGII's own `ITBIS2` bucket exists for, and which the e-CF
 *    builder already knew how to emit — was rejected. The scheme now carries every rate the regime
 *    levies, and the two components agree because they read the same table.
 * 3. **Nothing was rounded until the end.** The invoice accumulated `lineTotal * rate` in floating
 *    point while the e-CF rounded per bucket, so the document total and the transmitted total could
 *    differ by cents. Here every line is rounded to the currency's minor units first and the
 *    document is the sum of rounded lines — which is also how the DGII validates a comprobante.
 *
 * Everything is pure: no repository, no request, no clock. That is what makes it testable, and the
 * fiscal arithmetic is exactly the part that must be.
 */

export interface TaxableLineInput {
  quantity: number;
  /** Unit price, before discount, exclusive of tax. */
  unitPrice: number;
  /** Line discount as a fraction (0.10 = 10 %). */
  discountRate?: number;
  taxTreatment: TaxTreatment;
  /** Consumption-tax rate as a fraction. Ignored unless the treatment is TAXED. */
  taxRate: number;
  /** Excise (ISC) rate as a fraction. */
  exciseRate?: number;
  isService: boolean;
}

export interface DocumentTaxInput {
  /** ISO 3166-1 alpha-2 of the issuing organization; drives which rates are legal. */
  countryCode: string | null | undefined;
  /** ISO 4217 code of the document, which fixes the rounding precision. */
  currencyCode: string;
  lines: readonly TaxableLineInput[];
  /** Discount applied to the whole document, as a fraction of the post-line-discount subtotal. */
  documentDiscountRate?: number;
  /** Legally mandated service charge (propina legal), as a fraction. Never part of the tax base. */
  serviceChargeRate?: number;
  /** Fraction of the output tax the buyer withholds at source. */
  taxWithholdingRate?: number;
  /** Fraction of the taxable base withheld as income tax at source. */
  incomeTaxWithholdingRate?: number;
}

export interface ComputedLine {
  /** quantity × unitPrice, before discount. */
  gross: number;
  discountAmount: number;
  /** Taxable (or exempt) base of the line: gross − discount. */
  subtotal: number;
  taxAmount: number;
  exciseAmount: number;
  taxRate: number;
  taxTreatment: TaxTreatment;
  isService: boolean;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  /** Sum of line subtotals. */
  subtotal: number;
  /** Document-level discount only; line discounts are already inside `subtotal`. */
  discountTotal: number;
  taxedTotal: number;
  exemptTotal: number;
  goodsTotal: number;
  servicesTotal: number;
  tax: number;
  excise: number;
  serviceCharge: number;
  taxWithheld: number;
  incomeTaxWithheld: number;
  /** Face value: subtotal − documentDiscount + tax + excise + serviceCharge. */
  total: number;
  /** What the customer owes: total − amounts withheld at source. */
  netReceivable: number;
}

const EPSILON = 1e-6;

/** Round to the number of decimals the currency is actually expressed in. */
export function roundToCurrency(value: number, currencyCode: string): number {
  const factor = 10 ** minorUnitsFor(currencyCode);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Rates the country's regime levies, as fractions, or null when the market's base is sub-national
 * and cannot be constrained (United States, Brazil).
 */
export function allowedTaxFractions(countryCode: string | null | undefined): number[] | null {
  if (!countryCode) return null;
  const scheme = COUNTRY_TAX_SCHEMES[countryCode.toUpperCase()];
  if (!scheme || scheme.configurationRequired || scheme.taxes.length === 0) return null;
  return scheme.taxes.map((t) => t.rate / 100);
}

/**
 * Reject a rate the regime does not levy.
 *
 * Still worth doing even though the rate now comes from the catalogue: a catalogue entry can be
 * edited, and an item carrying 17 % ITBIS would be transmitted to the DGII and rejected there
 * instead of here.
 */
export function assertAllowedTaxRate(
  countryCode: string | null | undefined,
  requestedFraction: number,
): void {
  const allowed = allowedTaxFractions(countryCode);
  if (!allowed) return;
  if (allowed.some((rate) => Math.abs(rate - requestedFraction) < EPSILON)) return;

  const list = allowed.map((rate) => `${(rate * 100).toFixed(2).replace(/\.00$/, '')}%`).join(', ');
  throw new BadRequestException(
    `La tasa de impuesto ${(requestedFraction * 100).toFixed(2)}% no es válida para ${countryCode}. ` +
      `Tasas permitidas: ${list}.`,
  );
}

/**
 * Compute a whole sales document.
 *
 * Rounding rule, stated once because every downstream component depends on it: each line's
 * discount, base, tax and excise are rounded to the currency's minor units, and every total is the
 * sum of already-rounded parts. No total is ever computed from unrounded intermediates, which is
 * what guarantees that the printed document, the ledger entry, the QR code and the transmitted XML
 * all carry the same number.
 */
export function computeDocument(input: DocumentTaxInput): ComputedDocument {
  const currency = input.currencyCode;
  const round = (value: number) => roundToCurrency(value, currency);

  const lines: ComputedLine[] = [];
  let subtotal = 0;
  let taxedTotal = 0;
  let exemptTotal = 0;
  let goodsTotal = 0;
  let servicesTotal = 0;
  let tax = 0;
  let excise = 0;

  for (const line of input.lines) {
    assertFinitePositive(line.quantity, 'La cantidad');
    assertFiniteNonNegative(line.unitPrice, 'El precio unitario');

    const discountRate = line.discountRate ?? 0;
    if (discountRate < 0 || discountRate >= 1) {
      throw new BadRequestError('INVOICES.DESCUENTO_LINEA_DEBE_ESTAR_ENTRE_100_EXCLUSIVO');
    }

    const gross = round(line.quantity * line.unitPrice);
    const discountAmount = round(gross * discountRate);
    const lineSubtotal = round(gross - discountAmount);

    const effectiveRate = line.taxTreatment === TaxTreatment.TAXED ? line.taxRate : 0;
    if (effectiveRate < 0 || effectiveRate > 1) {
      throw new BadRequestError('INVOICES.TASA_IMPUESTO_DEBE_EXPRESARSE_COMO_FRACCION_ENTRE');
    }
    assertAllowedTaxRate(input.countryCode, effectiveRate);

    const exciseRate = line.exciseRate ?? 0;
    const exciseAmount = round(lineSubtotal * exciseRate);
    // Excise is part of the base the consumption tax is charged on, which is how the DGII computes
    // ITBIS on an item subject to ISC.
    const taxAmount = round((lineSubtotal + exciseAmount) * effectiveRate);

    lines.push({
      gross,
      discountAmount,
      subtotal: lineSubtotal,
      taxAmount,
      exciseAmount,
      taxRate: effectiveRate,
      taxTreatment: line.taxTreatment,
      isService: line.isService,
    });

    subtotal = round(subtotal + lineSubtotal);
    tax = round(tax + taxAmount);
    excise = round(excise + exciseAmount);
    if (line.taxTreatment === TaxTreatment.TAXED && effectiveRate > 0) {
      taxedTotal = round(taxedTotal + lineSubtotal);
    } else {
      exemptTotal = round(exemptTotal + lineSubtotal);
    }
    if (line.isService) {
      servicesTotal = round(servicesTotal + lineSubtotal);
    } else {
      goodsTotal = round(goodsTotal + lineSubtotal);
    }
  }

  const documentDiscountRate = input.documentDiscountRate ?? 0;
  if (documentDiscountRate < 0 || documentDiscountRate >= 1) {
    throw new BadRequestError('INVOICES.DESCUENTO_DOCUMENTO_DEBE_ESTAR_ENTRE_100_EXCLUSIVO');
  }
  const discountTotal = round(subtotal * documentDiscountRate);

  const serviceChargeRate = input.serviceChargeRate ?? 0;
  if (serviceChargeRate < 0 || serviceChargeRate > 0.5) {
    throw new BadRequestError('INVOICES.PROPINA_LEGAL_DEBE_ESTAR_ENTRE_50');
  }
  // The service charge is levied on the amount actually billed for goods and services, never on the
  // tax, and it is itself outside the tax base.
  const serviceCharge = round((subtotal - discountTotal) * serviceChargeRate);

  const taxWithholdingRate = input.taxWithholdingRate ?? 0;
  const incomeTaxWithholdingRate = input.incomeTaxWithholdingRate ?? 0;
  assertRateBetweenZeroAndOne(taxWithholdingRate, 'La retención de impuesto');
  assertRateBetweenZeroAndOne(incomeTaxWithholdingRate, 'La retención de renta');

  const taxWithheld = round(tax * taxWithholdingRate);
  const incomeTaxWithheld = round((subtotal - discountTotal) * incomeTaxWithholdingRate);

  const total = round(subtotal - discountTotal + tax + excise + serviceCharge);
  const netReceivable = round(total - taxWithheld - incomeTaxWithheld);

  return {
    lines,
    subtotal,
    discountTotal,
    taxedTotal,
    exemptTotal,
    goodsTotal,
    servicesTotal,
    tax,
    excise,
    serviceCharge,
    taxWithheld,
    incomeTaxWithheld,
    total,
    netReceivable,
  };
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestError('INVOICES.DEBE_SER_NUMERO_MAYOR_CERO', { label });
  }
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new BadRequestError('INVOICES.DEBE_SER_NUMERO_MAYOR_IGUAL_CERO', { label });
  }
}

function assertRateBetweenZeroAndOne(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new BadRequestError('INVOICES.DEBE_EXPRESARSE_COMO_FRACCION_ENTRE', { label });
  }
}
