import { BadRequestException } from '@nestjs/common';
import { computeDocument, assertAllowedTaxRate, roundToCurrency } from './sales-tax.engine';
import { TaxTreatment } from './entities/invoice-line-item.entity';

/**
 * The arithmetic of a fiscal document, tested.
 *
 * There was no test of any of this. The engine it replaces validated a tax rate and did nothing
 * else: totals were accumulated in floating point on one side of the module and rounded per bucket
 * on the other, so the invoice and the comprobante could disagree by cents with nothing to catch
 * it. Every case below is one the product actually issues.
 */
describe('sales-tax engine', () => {
  const taxedGood = {
    quantity: 1,
    unitPrice: 1000,
    taxTreatment: TaxTreatment.TAXED,
    taxRate: 0.18,
    isService: false,
  };

  describe('the basic document', () => {
    it('computes the tax on the line base', () => {
      const doc = computeDocument({ countryCode: 'DO', currencyCode: 'DOP', lines: [taxedGood] });
      expect(doc.subtotal).toBe(1000);
      expect(doc.tax).toBe(180);
      expect(doc.total).toBe(1180);
      expect(doc.netReceivable).toBe(1180);
    });

    it('splits goods from services, because the 606/607 report them separately', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [taxedGood, { ...taxedGood, unitPrice: 500, isService: true }],
      });
      expect(doc.goodsTotal).toBe(1000);
      expect(doc.servicesTotal).toBe(500);
    });

    it('splits the taxed base from the exempt one', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [taxedGood, { ...taxedGood, unitPrice: 300, taxTreatment: TaxTreatment.EXEMPT, taxRate: 0 }],
      });
      expect(doc.taxedTotal).toBe(1000);
      expect(doc.exemptTotal).toBe(300);
      expect(doc.tax).toBe(180);
      expect(doc.total).toBe(1480);
    });

    it('ignores a rate on a line that is not taxed', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        // A caller sending a rate on an exempt line must not be able to tax it anyway.
        lines: [{ ...taxedGood, taxTreatment: TaxTreatment.EXEMPT, taxRate: 0.18 }],
      });
      expect(doc.tax).toBe(0);
    });
  });

  describe('rounding', () => {
    it('rounds per line, so the document equals the sum of its printed lines', () => {
      // Three lines of 10.01 at 18 %: rounded per line the tax is 1.80 × 3, and the total must be
      // the sum of what each line shows — not a figure derived from an unrounded intermediate.
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: Array.from({ length: 3 }, () => ({ ...taxedGood, unitPrice: 10.01 })),
      });
      expect(doc.subtotal).toBe(30.03);
      expect(doc.tax).toBe(5.4);
      expect(doc.total).toBe(35.43);
      expect(doc.lines.reduce((s, l) => s + l.subtotal + l.taxAmount, 0)).toBeCloseTo(doc.total, 2);
    });

    it('respects a currency with no minor units', () => {
      // Chilean pesos carry no decimals; rounding them to two produces totals the SII rejects.
      const doc = computeDocument({
        countryCode: 'CL',
        currencyCode: 'CLP',
        lines: [{ ...taxedGood, unitPrice: 1999, taxRate: 0.19 }],
      });
      expect(doc.tax).toBe(380);
      expect(Number.isInteger(doc.total)).toBe(true);
    });

    it('rounds to the currency, not to two places', () => {
      expect(roundToCurrency(1234.567, 'DOP')).toBe(1234.57);
      expect(roundToCurrency(1234.567, 'CLP')).toBe(1235);
      expect(roundToCurrency(1234.567, 'PYG')).toBe(1235);
    });
  });

  describe('discounts', () => {
    it('applies a line discount before tax', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [{ ...taxedGood, discountRate: 0.1 }],
      });
      expect(doc.subtotal).toBe(900);
      expect(doc.tax).toBe(162);
      expect(doc.total).toBe(1062);
    });

    it('applies a document discount without restating the tax base of the lines', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [taxedGood],
        documentDiscountRate: 0.05,
      });
      expect(doc.discountTotal).toBe(50);
      expect(doc.total).toBe(1130);
    });

    it('refuses a discount of 100 % or more', () => {
      expect(() =>
        computeDocument({
          countryCode: 'DO',
          currencyCode: 'DOP',
          lines: [{ ...taxedGood, discountRate: 1 }],
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('service charge and withholding', () => {
    it('adds the legal service charge outside the tax base', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [taxedGood],
        serviceChargeRate: 0.1,
      });
      // 10 % of the billed amount, and the ITBIS is unchanged by it.
      expect(doc.serviceCharge).toBe(100);
      expect(doc.tax).toBe(180);
      expect(doc.total).toBe(1280);
    });

    it('reduces what the customer owes by what they withhold at source', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [taxedGood],
        taxWithholdingRate: 0.3,
        incomeTaxWithholdingRate: 0.1,
      });
      expect(doc.taxWithheld).toBe(54);
      expect(doc.incomeTaxWithheld).toBe(100);
      // The document is still worth 1180; the customer pays 1026 and remits the rest.
      expect(doc.total).toBe(1180);
      expect(doc.netReceivable).toBe(1026);
    });
  });

  describe('excise duty', () => {
    it('charges the consumption tax on the base including the excise', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [{ ...taxedGood, exciseRate: 0.1 }],
      });
      expect(doc.excise).toBe(100);
      expect(doc.tax).toBe(198);
      expect(doc.total).toBe(1298);
    });
  });

  describe('rate validation', () => {
    it('accepts every rate the Dominican regime levies, including the reduced one', () => {
      expect(() => assertAllowedTaxRate('DO', 0.18)).not.toThrow();
      // 16 % is the rate the DGII's own ITBIS2 bucket exists for. Rejecting it meant the validator
      // and the comprobante builder disagreed about the same regime.
      expect(() => assertAllowedTaxRate('DO', 0.16)).not.toThrow();
      expect(() => assertAllowedTaxRate('DO', 0)).not.toThrow();
    });

    it('rejects a rate the regime does not levy', () => {
      expect(() => assertAllowedTaxRate('DO', 0.21)).toThrow(BadRequestException);
    });

    it('does not constrain a market whose base is sub-national', () => {
      // Sales tax in the United States is set by state, county and city; no national rate exists.
      expect(() => assertAllowedTaxRate('US', 0.0825)).not.toThrow();
      expect(() => assertAllowedTaxRate('BR', 0.17)).not.toThrow();
    });

    it('accepts each market its own rates', () => {
      expect(() => assertAllowedTaxRate('MX', 0.16)).not.toThrow();
      expect(() => assertAllowedTaxRate('MX', 0.08)).not.toThrow();
      expect(() => assertAllowedTaxRate('AR', 0.105)).not.toThrow();
      expect(() => assertAllowedTaxRate('MX', 0.18)).toThrow(BadRequestException);
    });
  });

  describe('input validation', () => {
    it('refuses a non-positive quantity', () => {
      expect(() =>
        computeDocument({ countryCode: 'DO', currencyCode: 'DOP', lines: [{ ...taxedGood, quantity: 0 }] }),
      ).toThrow(BadRequestException);
    });

    it('refuses a negative price', () => {
      expect(() =>
        computeDocument({ countryCode: 'DO', currencyCode: 'DOP', lines: [{ ...taxedGood, unitPrice: -1 }] }),
      ).toThrow(BadRequestException);
    });

    it('accepts a fractional quantity', () => {
      const doc = computeDocument({
        countryCode: 'DO',
        currencyCode: 'DOP',
        lines: [{ ...taxedGood, quantity: 1.5 }],
      });
      expect(doc.subtotal).toBe(1500);
    });
  });
});
