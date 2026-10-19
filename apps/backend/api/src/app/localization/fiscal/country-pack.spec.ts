import esCatalogue from '../../i18n/messages/es.json';
import enCatalogue from '../../i18n/messages/en.json';
import ptCatalogue from '../../i18n/messages/pt.json';
import {
  COUNTRY_PACKS,
  DEFAULT_CUSTOMER_NAME_KEYS,
  PAYMENT_SETTLEMENT_KINDS,
  countryPackFor,
} from '../../contracts/country-pack/country-pack';
import { COUNTRY_FISCAL_PROFILES } from './country-profiles';
import { COUNTRY_TAX_SCHEMES } from './country-tax-schemes';
import { languageOfCountry } from './country-language';
import { coverageFor } from './fiscal-coverage';
import { publicCountryPack } from './public-country-pack';

/**
 * The country pack contract (QA C-06): every market sold answers every question, and the answers
 * agree with the rest of the country catalogue.
 *
 * A US company used to get the Dominican product because the questions — who owns the payment
 * methods, is there withholding, what does the default customer call itself — had one answer,
 * written for the first market. These tests are what stop a new market from inheriting it again.
 */
const es: Record<string, string> = esCatalogue;
const en: Record<string, string> = enCatalogue;
const pt: Record<string, string> = ptCatalogue;

describe('country packs', () => {
  const markets = COUNTRY_FISCAL_PROFILES.map((profile) => profile.countryCode);
  const catalogues: Record<string, Record<string, string>> = { es, en, pt };

  it('declares a pack for every market the product registers, and none it does not', () => {
    expect(Object.keys(COUNTRY_PACKS).sort()).toEqual([...markets].sort());
  });

  it.each(markets)('%s: keeps its books in the language of its profile', (code) => {
    expect(COUNTRY_PACKS[code].booksLanguage).toBe(languageOfCountry(code));
  });

  it.each(markets)('%s: states its tax model as its tax scheme does', (code) => {
    const determined = COUNTRY_TAX_SCHEMES[code]?.configurationRequired === true;
    expect(COUNTRY_PACKS[code].taxes.model).toBe(determined ? 'BY_JURISDICTION' : 'NATIONAL_RATES');
  });

  it.each(markets)('%s: generates fiscal returns exactly where the coverage says it does', (code) => {
    const coverage = coverageFor(code).capabilities;
    const implemented = (capability: string) =>
      coverage.some((entry) => entry.capability === capability && entry.level === 'implemented');
    const generator = COUNTRY_PACKS[code].fiscalReturns.generator;
    expect(generator !== null).toBe(implemented('periodicReturns') || implemented('electronicAccounting'));
    // Where it generates nothing, it says what to prepare the returns with instead.
    if (generator === null) expect(COUNTRY_PACKS[code].fiscalReturns.prepareWith.length).toBeGreaterThan(0);
  });

  it.each(markets)('%s: seeds well-formed payment methods with distinct codes', (code) => {
    const methods = COUNTRY_PACKS[code].paymentMethods.defaults;
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods.map((method) => method.code)).size).toBe(methods.length);
    for (const method of methods) {
      expect(method.code).toMatch(/^[A-Z0-9_-]{1,20}$/);
      expect(PAYMENT_SETTLEMENT_KINDS).toContain(method.kind);
    }
  });

  it.each(markets)('%s: names every seeded row with a key the API catalogue holds in all languages', (code) => {
    const pack = COUNTRY_PACKS[code];
    const keys = [
      pack.defaultCustomer.nameKey,
      pack.taxes.nameKey,
      pack.documents.supplierDocumentNumberKey,
      ...pack.paymentMethods.defaults.map((method) => method.nameKey),
      ...pack.payroll.parameters.map((parameter) => parameter.nameKey),
      ...pack.payroll.concepts.map((concept) => concept.nameKey),
      ...pack.fiscalReturns.prepareWith.map((report) => report.labelKey),
    ];
    for (const key of keys) {
      for (const language of ['es', 'en', 'pt']) {
        expect([language, key, catalogues[language][key]]).toEqual([language, key, expect.any(String)]);
      }
    }
  });

  it('fixes the payment methods only where the authority does: the DGII 606 codes, 01 to 07', () => {
    const fixed = markets.filter((code) => COUNTRY_PACKS[code].paymentMethods.catalogue === 'AUTHORITY_FIXED');
    expect(fixed).toEqual(['DO']);
    expect(COUNTRY_PACKS['DO'].paymentMethods.defaults.map((method) => method.code)).toEqual([
      '01', '02', '03', '04', '05', '06', '07',
    ]);
    expect(COUNTRY_PACKS['DO'].paymentMethods.defaults.every((method) => method.fiscalCode === method.code)).toBe(true);
  });

  it('gives the United States its own product: no withholding, no NCF, sales tax by state, its payment methods', () => {
    const us = COUNTRY_PACKS['US'];
    expect(us.withholding.applies).toBe(false);
    expect(us.documents).toMatchObject({ fiscalNumbering: false, supplierFiscalNumber: false, purchaseClassification: false });
    expect(us.taxes.model).toBe('BY_JURISDICTION');
    expect(us.paymentMethods.catalogue).toBe('EDITABLE');
    expect(us.paymentMethods.defaults.map((method) => method.code)).toEqual(
      expect.arrayContaining(['ACH', 'WIRE', 'CHECK', 'ZELLE', 'CARD', 'CASH']),
    );
    expect(en[us.defaultCustomer.nameKey]).toBe('Walk-in customer');
    expect(us.examples.city).not.toBe('Santo Domingo');
  });

  it('keeps the Dominican answers where they belong', () => {
    const dominican = COUNTRY_PACKS['DO'];
    expect(dominican.withholding.applies).toBe(true);
    expect(dominican.documents).toMatchObject({ fiscalNumbering: true, supplierFiscalNumber: true, purchaseClassification: true });
    expect(dominican.fiscalReturns).toMatchObject({ generator: 'DGII', dueDay: 15 });
    expect(dominican.payroll.statutoryParameters).toBe('PLATFORM');
    expect(es[dominican.defaultCustomer.nameKey]).toBe('Consumidor final');
  });

  it('names the anonymous buyer as each market does', () => {
    expect(es[COUNTRY_PACKS['MX'].defaultCustomer.nameKey]).toBe('Público en general');
    expect(es[COUNTRY_PACKS['CO'].defaultCustomer.nameKey]).toBe('Consumidor final');
    expect(pt[COUNTRY_PACKS['BR'].defaultCustomer.nameKey]).toBe('Consumidor final');
    for (const pack of Object.values(COUNTRY_PACKS)) {
      expect(DEFAULT_CUSTOMER_NAME_KEYS).toContain(pack.defaultCustomer.nameKey);
    }
  });

  describe('US payroll defaults', () => {
    const byCode = Object.fromEntries(COUNTRY_PACKS['US'].payroll.parameters.map((p) => [p.code, p]));

    it('seeds FICA, Medicare and FUTA as dated statutory defaults', () => {
      expect(byCode['FICA_SOCIAL_SECURITY']).toMatchObject({ employeeRate: 0.062, employerRate: 0.062, wageBase: 184_500 });
      expect(byCode['FICA_MEDICARE']).toMatchObject({ employeeRate: 0.0145, employerRate: 0.0145 });
      expect(byCode['FICA_MEDICARE']?.wageBase).toBeUndefined();
      expect(byCode['FICA_MEDICARE_ADDITIONAL']).toMatchObject({ employeeRate: 0.009, employerRate: 0, threshold: 200_000 });
      expect(byCode['FUTA']).toMatchObject({ employerRate: 0.06, wageBase: 7_000, creditRate: 0.054 });
      for (const parameter of COUNTRY_PACKS['US'].payroll.parameters) {
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
      const concepts = COUNTRY_PACKS['US'].payroll.concepts;
      const system = concepts.filter((concept) => concept.isSystem).map((concept) => concept.code);
      expect(system).toEqual(expect.arrayContaining(['SS', 'MEDICARE', 'FIT', 'SIT', 'ER_SS', 'ER_MEDICARE', 'FUTA', 'SUTA']));
      expect(new Set(concepts.map((concept) => concept.code)).size).toBe(concepts.length);
    });
  });

  it('gives an unknown market a neutral pack, never the Dominican one', () => {
    const unknown = countryPackFor('ES');
    expect(unknown.withholding.applies).toBe(false);
    expect(unknown.documents.fiscalNumbering).toBe(false);
    expect(unknown.paymentMethods.catalogue).toBe('EDITABLE');
    expect(unknown.payroll.concepts).toEqual([]);
    expect(countryPackFor(null).countryCode).toBe('');
    expect(countryPackFor('us').countryCode).toBe('US');
  });

  it('publishes the capabilities and the profile facts, not the seeds', () => {
    const pack = publicCountryPack('US');
    expect(pack.fiscalAuthority).toBe('IRS');
    expect(pack.divisions.map((division) => division.code)).toContain('TX');
    expect(pack.withholding.applies).toBe(false);
    expect(pack.paymentMethods).toEqual({ catalogue: 'EDITABLE', authority: null });
    expect(JSON.stringify(pack)).not.toContain('FICA');
  });
});
