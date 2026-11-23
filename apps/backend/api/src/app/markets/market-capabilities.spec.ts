import esCatalogue from '../i18n/messages/es.json';
import enCatalogue from '../i18n/messages/en.json';
import ptCatalogue from '../i18n/messages/pt.json';
import { PAYMENT_SETTLEMENT_KINDS } from './contracts';
import { DEFAULT_CUSTOMER_NAME_KEYS } from './queries/profile';
import { coverageFor } from './queries/coverage';
import { allMarkets, knownMarket, marketCodes, marketFor } from './registry';

/**
 * What every market answers (QA C-06): every market sold answers every question, and the answers
 * agree with one another.
 *
 * A US company used to get the Dominican product because the questions — who owns the payment
 * methods, is there withholding, what does the default customer call itself — had one answer,
 * written for the first market. These tests are what stop a new market from inheriting it again.
 */
const es: Record<string, string> = esCatalogue;
const en: Record<string, string> = enCatalogue;
const pt: Record<string, string> = ptCatalogue;

describe('market capabilities', () => {
  const markets = [...marketCodes()];
  const catalogues: Record<string, Record<string, string>> = { es, en, pt };
  const market = (code: string) => {
    const found = knownMarket(code);
    if (!found) throw new Error(`${code} is not in the catalogue`);
    return found;
  };

  it.each(markets)('%s: states its tax model as its tax scheme does', (code) => {
    const { taxes } = market(code);
    expect(taxes.model).toBe(taxes.scheme.configurationRequired ? 'BY_JURISDICTION' : 'NATIONAL_RATES');
  });

  it.each(markets)('%s: generates fiscal returns exactly where the coverage says it does', (code) => {
    const coverage = coverageFor(code).capabilities;
    // Built: implemented, or built and waiting on the tenant's own data (`needs-configuration`).
    const built = (capability: string) =>
      coverage.some(
        (entry) => entry.capability === capability && (entry.level === 'implemented' || entry.level === 'needs-configuration'),
      );
    const generator = market(code).returns.generator;
    expect(generator !== null).toBe(built('periodicReturns') || built('electronicAccounting'));
    // Where it generates nothing, it says what to prepare the returns with instead.
    if (generator === null) expect(market(code).returns.prepareWith.length).toBeGreaterThan(0);
  });

  it.each(markets)('%s: seeds well-formed payment methods with distinct codes', (code) => {
    const methods = market(code).payments.defaults;
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods.map((method) => method.code)).size).toBe(methods.length);
    for (const method of methods) {
      expect(method.code).toMatch(/^[A-Z0-9_-]{1,20}$/);
      expect(PAYMENT_SETTLEMENT_KINDS).toContain(method.kind);
    }
  });

  it.each(markets)('%s: names every seeded row with a key the API catalogue holds in all languages', (code) => {
    const m = market(code);
    const keys = [
      m.documents.defaultCustomer.nameKey,
      m.taxes.nameKey,
      m.purchases.receivedDocument.labelKey,
      ...m.payments.defaults.map((method) => method.nameKey),
      ...m.payroll.parameters.map((parameter) => parameter.nameKey),
      ...m.payroll.concepts.map((concept) => concept.nameKey),
      ...m.returns.prepareWith.map((report) => report.labelKey),
    ];
    for (const key of keys) {
      for (const language of ['es', 'en', 'pt']) {
        expect([language, key, catalogues[language][key]]).toEqual([language, key, expect.any(String)]);
      }
    }
  });

  it('fixes the payment methods only where the authority does: the DGII 606 codes, 01 to 07', () => {
    const fixed = markets.filter((code) => market(code).payments.catalogue === 'AUTHORITY_FIXED');
    expect(fixed).toEqual(['DO']);
    expect(market('DO').payments.defaults.map((method) => method.code)).toEqual([
      '01', '02', '03', '04', '05', '06', '07',
    ]);
    expect(market('DO').payments.defaults.every((method) => method.fiscalCode === method.code)).toBe(true);
  });

  it('gives the United States its own product: no withholding, no NCF, sales tax by state, its payment methods', () => {
    const us = market('US');
    expect(us.taxes.withholding.applies).toBe(false);
    expect(us.documents.fiscalNumbering).toBe(false);
    expect(us.purchases).toMatchObject({ supplierFiscalNumber: false, purchaseClassification: false });
    expect(us.taxes.model).toBe('BY_JURISDICTION');
    expect(us.payments.catalogue).toBe('EDITABLE');
    expect(us.payments.defaults.map((method) => method.code)).toEqual(
      expect.arrayContaining(['ACH', 'WIRE', 'CHECK', 'ZELLE', 'CARD', 'CASH']),
    );
    expect(en[us.documents.defaultCustomer.nameKey]).toBe('Walk-in customer');
    expect(us.profile.examples.city).not.toBe('Santo Domingo');
  });

  it('keeps the Dominican answers where they belong', () => {
    const dominican = market('DO');
    expect(dominican.taxes.withholding.applies).toBe(true);
    expect(dominican.documents.fiscalNumbering).toBe(true);
    expect(dominican.purchases).toMatchObject({ supplierFiscalNumber: true, purchaseClassification: true });
    expect(dominican.returns).toMatchObject({ generator: 'DGII', dueDay: 15 });
    expect(dominican.payroll.statutoryParameters).toBe('PLATFORM');
    expect(es[dominican.documents.defaultCustomer.nameKey]).toBe('Consumidor final');
  });

  it('names the anonymous buyer as each market does', () => {
    expect(es[market('MX').documents.defaultCustomer.nameKey]).toBe('Público en general');
    expect(es[market('CO').documents.defaultCustomer.nameKey]).toBe('Consumidor final');
    expect(pt[market('BR').documents.defaultCustomer.nameKey]).toBe('Consumidor final');
    for (const m of allMarkets()) {
      expect(DEFAULT_CUSTOMER_NAME_KEYS).toContain(m.documents.defaultCustomer.nameKey);
    }
  });

  describe('US payroll defaults', () => {
    const byCode = Object.fromEntries(market('US').payroll.parameters.map((p) => [p.code, p]));

    it('seeds FICA, Medicare and FUTA as dated statutory defaults', () => {
      expect(byCode['FICA_SOCIAL_SECURITY']).toMatchObject({ employeeRate: 0.062, employerRate: 0.062, wageBase: 184_500 });
      expect(byCode['FICA_MEDICARE']).toMatchObject({ employeeRate: 0.0145, employerRate: 0.0145 });
      expect(byCode['FICA_MEDICARE']?.wageBase).toBeUndefined();
      expect(byCode['FICA_MEDICARE_ADDITIONAL']).toMatchObject({ employeeRate: 0.009, employerRate: 0, threshold: 200_000 });
      expect(byCode['FUTA']).toMatchObject({ employerRate: 0.06, wageBase: 7_000, creditRate: 0.054 });
      for (const parameter of market('US').payroll.parameters) {
        expect(parameter.effectiveFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(parameter.legalBasis.length).toBeGreaterThan(0);
      }
    });

    it('leaves the withholding tables and the state unemployment rate for the company to enter', () => {
      for (const code of ['FEDERAL_INCOME_TAX_WITHHOLDING', 'STATE_INCOME_TAX_WITHHOLDING', 'STATE_UNEMPLOYMENT']) {
        expect(byCode[code]?.requiresInput).toBe(true);
        expect(byCode[code]?.employeeRate).toBeUndefined();
      }
      expect(byCode['FEDERAL_INCOME_TAX_WITHHOLDING']?.kind).toBe('TABLE');
    });

    it('seeds the US payroll concepts with the statutory lines marked as system', () => {
      const concepts = market('US').payroll.concepts;
      const system = concepts.filter((concept) => concept.isSystem).map((concept) => concept.code);
      expect(system).toEqual(expect.arrayContaining(['SS', 'MEDICARE', 'FIT', 'SIT', 'ER_SS', 'ER_MEDICARE', 'FUTA', 'SUTA']));
      expect(new Set(concepts.map((concept) => concept.code)).size).toBe(concepts.length);
    });
  });

  it('gives an unknown market the neutral answers, never the Dominican ones', () => {
    const unknown = marketFor('ES');
    expect(unknown.taxes.withholding.applies).toBe(false);
    expect(unknown.documents.fiscalNumbering).toBe(false);
    expect(unknown.payments.catalogue).toBe('EDITABLE');
    expect(unknown.payroll.concepts).toEqual([]);
    expect(marketFor(null).code).toBe('');
    expect(marketFor('us').code).toBe('US');
  });
});
