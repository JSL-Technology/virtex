import { COUNTRY_TAX_SCHEMES } from '../localization/fiscal/country-tax-schemes';
import { TaxTreatment } from './entities/invoice-line-item.entity';
import { allocate, roundToCurrency, sumInCurrency } from '../common/money';
import { BadRequestError } from '../i18n/localized.exception';

/**
 * Re-exported so the fiscal components that already import it from here keep working. The
 * implementation is `common/money.ts`, which is the single rounding authority in the backend —
 * this file used to carry a second one with a different tie-breaking rule from the ledger's.
 */
export { roundToCurrency };

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
  /**
   * The rates in the tenant's own tax catalogue, as fractions.
   *
   * Accepted alongside the country's table, not instead of it. The catalogue is seeded from that
   * table at provisioning and editable afterwards — it is how a tenant states a reduced rate for a
   * specific good, or a rate decreed between releases — and nothing in the calculation path read
   * it, so a rate the tenant had deliberately configured was rejected as one its country does not
   * levy.
   */
  tenantTaxRates?: readonly number[];
  lines: readonly TaxableLineInput[];
  /**
   * Commercial discount on the whole document, as a fraction of the post-line-discount subtotal.
   *
   * It is prorated across the lines and **reduces the taxable base**, which is what a commercial
   * discount granted at the moment of invoicing does in every regime this product sells into. It
   * used to be subtracted from the face total only, after the tax had already been accumulated on
   * the undiscounted line subtotals: a 100 000 invoice with 10 % document discount charged 18 000
   * of ITBIS where 16 200 was due. The customer was overcharged, the return overstated the tax, and
   * the e-CF could not validate — the DGII recomputes `ITBIS = MontoGravado × tasa`, and
   * `MontoGravado` is `taxedTotal`, which is now net of the discount.
   *
   * A financial discount for early settlement is a different thing, is granted after the document
   * exists, and belongs on the collection (`CustomerPaymentLine.discount`), not here.
   */
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
  /** Line-level discount. */
  discountAmount: number;
  /** gross − line discount. Not the tax base: the document discount comes off it. */
  subtotal: number;
  /** This line's share of the document-level discount, allocated by largest remainder. */
  documentDiscountAmount: number;
  /** What tax and excise are actually charged on: `subtotal − documentDiscountAmount`. */
  taxableBase: number;
  taxAmount: number;
  exciseAmount: number;
  taxRate: number;
  taxTreatment: TaxTreatment;
  isService: boolean;
}

export interface ComputedDocument {
  lines: ComputedLine[];
  /** Sum of line subtotals, before the document discount. */
  subtotal: number;
  /** Document-level discount only; line discounts are already inside `subtotal`. */
  discountTotal: number;
  /**
   * The taxed and exempt **bases**, net of the document discount.
   *
   * These are what the fiscal reports and the e-CF carry as `MontoGravado` / `MontoExento`, and
   * what the authority multiplies by the rate to check the tax. They are therefore net of every
   * discount, not just the line ones.
   */
  taxedTotal: number;
  exemptTotal: number;
  /** Goods and services bases, also net of the document discount, for the 606/607 split. */
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

/**
 * Rates the country's regime levies, as fractions, or null when the market's base is sub-national
 * and cannot be constrained (United States, Brazil).
 *
 * `tenantRates` are the rows of the tenant's own tax catalogue, which is seeded from this table at
 * provisioning and editable afterwards. Both are consulted: the catalogue was the tenant's only
 * way to express a rate — a reduced rate for a specific good, a rate decreed between releases —
 * and nothing in the calculation path read it, so a rate a tenant had deliberately configured was
 * rejected as one its country does not levy. Two sources of truth for the same fact, and the one
 * the tenant maintained was the dead one.
 */
export function allowedTaxFractions(
  countryCode: string | null | undefined,
  tenantRates: readonly number[] = [],
): number[] | null {
  const scheme = countryCode ? COUNTRY_TAX_SCHEMES[countryCode.toUpperCase()] : undefined;
  const fromScheme =
    scheme && !scheme.configurationRequired && scheme.taxes.length > 0
      ? scheme.taxes.map((t) => t.rate / 100)
      : null;

  // A market whose base is sub-national constrains nothing on its own; if the tenant has stated
  // its own rates, those are the constraint.
  if (!fromScheme) return tenantRates.length > 0 ? [...tenantRates] : null;

  const combined = [...fromScheme];
  for (const rate of tenantRates) {
    if (!combined.some((known) => Math.abs(known - rate) < EPSILON)) combined.push(rate);
  }
  return combined;
}

/**
 * Reject a rate neither the regime nor the tenant's catalogue carries.
 *
 * Still worth doing even though the rate comes from the catalogue: a catalogue entry can be
 * edited, and an item carrying 17 % ITBIS would be transmitted to the DGII and rejected there
 * instead of here.
 */
export function assertAllowedTaxRate(
  countryCode: string | null | undefined,
  requestedFraction: number,
  tenantRates: readonly number[] = [],
): void {
  const allowed = allowedTaxFractions(countryCode, tenantRates);
  if (!allowed) return;
  if (allowed.some((rate) => Math.abs(rate - requestedFraction) < EPSILON)) return;

  const list = allowed.map((rate) => `${(rate * 100).toFixed(2).replace(/\.00$/, '')}%`).join(', ');
  // A key, like every other refusal in this module. This one was a Spanish sentence built in the
  // service and thrown as a bare `BadRequestException`, so a reader in another language got
  // Spanish and the i18n coverage check could not see it.
  throw new BadRequestError('INVOICES.TASA_IMPUESTO_NO_VALIDA_PARA_PAIS', {
    rate: `${(requestedFraction * 100).toFixed(2)}%`,
    countryCode: countryCode ?? '—',
    allowed: list,
  });
}

/**
 * Compute a whole sales document.
 *
 * Rounding rule, stated once because every downstream component depends on it: each line's
 * discount, base, tax and excise are rounded to the currency's minor units, and every total is the
 * sum of already-rounded parts. No total is ever computed from unrounded intermediates, which is
 * what guarantees that the printed document, the ledger entry, the QR code and the transmitted XML
 * all carry the same number.
 *
 * Two passes, because the document discount reduces the tax base. The first computes each line's
 * base before it; the discount is then rounded once at document level and allocated across the
 * lines by largest remainder, so the shares sum back to it exactly; the second charges tax and
 * excise on `subtotal − share`. Doing it in one pass is what produced tax on an undiscounted base.
 */
export function computeDocument(input: DocumentTaxInput): ComputedDocument {
  const currency = input.currencyCode;
  const round = (value: number) => roundToCurrency(value, currency);
  const sum = (values: readonly number[]) => sumInCurrency(values, currency);

  // ── Pass 1: line bases, before the document discount ──────────────────────
  const bases = input.lines.map((line) => {
    assertFinitePositive(line.quantity, 'La cantidad');
    assertFiniteNonNegative(line.unitPrice, 'El precio unitario');

    const discountRate = line.discountRate ?? 0;
    if (discountRate < 0 || discountRate >= 1) {
      throw new BadRequestError('INVOICES.DESCUENTO_LINEA_DEBE_ESTAR_ENTRE_100_EXCLUSIVO');
    }

    const effectiveRate = line.taxTreatment === TaxTreatment.TAXED ? line.taxRate : 0;
    if (effectiveRate < 0 || effectiveRate > 1) {
      throw new BadRequestError('INVOICES.TASA_IMPUESTO_DEBE_EXPRESARSE_COMO_FRACCION_ENTRE');
    }
    assertAllowedTaxRate(input.countryCode, effectiveRate, input.tenantTaxRates);

    const exciseRate = line.exciseRate ?? 0;
    if (exciseRate < 0 || exciseRate > 1) {
      throw new BadRequestError('INVOICES.TASA_IMPUESTO_DEBE_EXPRESARSE_COMO_FRACCION_ENTRE');
    }

    const gross = round(line.quantity * line.unitPrice);
    const discountAmount = round(gross * discountRate);
    const lineSubtotal = round(gross - discountAmount);

    return { line, gross, discountAmount, lineSubtotal, effectiveRate, exciseRate };
  });

  const subtotal = sum(bases.map((base) => base.lineSubtotal));

  // ── The document discount, prorated over the lines ────────────────────────
  //
  // Rounded once at document level and then allocated by largest remainder, so the parts sum back
  // to it exactly. Rounding each line's share independently leaves a residue of a minor unit or
  // two, and dropping it makes the invoice total stop matching the sum of its lines.
  const documentDiscountRate = input.documentDiscountRate ?? 0;
  if (documentDiscountRate < 0 || documentDiscountRate >= 1) {
    throw new BadRequestError('INVOICES.DESCUENTO_DOCUMENTO_DEBE_ESTAR_ENTRE_100_EXCLUSIVO');
  }
  const discountTotal = round(subtotal * documentDiscountRate);
  const documentDiscountShares = allocate(
    discountTotal,
    bases.map((base) => base.lineSubtotal),
    currency,
  );

  // ── Pass 2: tax on the discounted base ────────────────────────────────────
  const lines: ComputedLine[] = bases.map((base, index) => {
    const documentDiscountAmount = documentDiscountShares[index];
    const taxableBase = round(base.lineSubtotal - documentDiscountAmount);
    const exciseAmount = round(taxableBase * base.exciseRate);
    // Excise is part of the base the consumption tax is charged on, which is how the DGII computes
    // ITBIS on an item subject to ISC.
    const taxAmount = round((taxableBase + exciseAmount) * base.effectiveRate);

    return {
      gross: base.gross,
      discountAmount: base.discountAmount,
      subtotal: base.lineSubtotal,
      documentDiscountAmount,
      taxableBase,
      taxAmount,
      exciseAmount,
      taxRate: base.effectiveRate,
      taxTreatment: base.line.taxTreatment,
      isService: base.line.isService,
    };
  });

  const isTaxed = (line: ComputedLine) =>
    line.taxTreatment === TaxTreatment.TAXED && line.taxRate > 0;

  const tax = sum(lines.map((line) => line.taxAmount));
  const excise = sum(lines.map((line) => line.exciseAmount));
  const taxedTotal = sum(lines.filter(isTaxed).map((line) => line.taxableBase));
  const exemptTotal = sum(
    lines.filter((line) => !isTaxed(line)).map((line) => line.taxableBase),
  );
  const servicesTotal = sum(
    lines.filter((line) => line.isService).map((line) => line.taxableBase),
  );
  const goodsTotal = sum(
    lines.filter((line) => !line.isService).map((line) => line.taxableBase),
  );

  const netOfDiscount = round(subtotal - discountTotal);

  const serviceChargeRate = input.serviceChargeRate ?? 0;
  if (serviceChargeRate < 0 || serviceChargeRate > 0.5) {
    throw new BadRequestError('INVOICES.PROPINA_LEGAL_DEBE_ESTAR_ENTRE_50');
  }
  // The service charge is levied on the amount actually billed for goods and services, never on the
  // tax, and it is itself outside the tax base.
  const serviceCharge = round(netOfDiscount * serviceChargeRate);

  const taxWithholdingRate = input.taxWithholdingRate ?? 0;
  const incomeTaxWithholdingRate = input.incomeTaxWithholdingRate ?? 0;
  assertRateBetweenZeroAndOne(taxWithholdingRate, 'La retención de impuesto');
  assertRateBetweenZeroAndOne(incomeTaxWithholdingRate, 'La retención de renta');

  const taxWithheld = round(tax * taxWithholdingRate);
  const incomeTaxWithheld = round(netOfDiscount * incomeTaxWithholdingRate);

  const total = round(netOfDiscount + tax + excise + serviceCharge);
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
