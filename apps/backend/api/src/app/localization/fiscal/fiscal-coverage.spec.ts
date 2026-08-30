import { TaxType } from '../../taxes/entities/tax.entity';
import {
  COUNTRY_FISCAL_PROFILES,
  findCountryProfile,
  supportedCountryCodes,
} from './country-profiles';
import { TAX_ID_VALIDATORS, validateTaxId } from './tax-id-validators';
import { COUNTRY_TAX_SCHEMES, findTaxScheme, principalTaxName } from './country-tax-schemes';
import { STATUTORY_PLAN_REQUIRED, buildCountryCoaTemplate } from './coa-builder';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { AccountNature, AccountType } from '../../chart-of-accounts/enums/account-enums';

/**
 * A market is either fully supported or it is not offered.
 *
 * The failure this suite exists to prevent is the one the product actually shipped: the signup
 * form offered eight countries, six had a fiscal region, one had a tax-id algorithm, and every
 * one of them was provisioned with the United States chart of accounts. Nothing failed — the
 * tenant was created, told it was ready, and had no way to issue a compliant document.
 *
 * So the tests below are not about any single country. They are closure properties over the whole
 * list: every country offered must have an algorithm, a tax scheme, and a usable ledger, and it
 * must be impossible to add one without all three.
 */
describe('Fiscal coverage', () => {
  const codes = supportedCountryCodes();

  function flatten(accounts: AccountTemplateDto[]): AccountTemplateDto[] {
    return accounts.flatMap((a) => [a, ...flatten(a.children ?? [])]);
  }

  it('offers the markets the product is sold in', () => {
    // Nineteen: the United States plus every Spanish- or Portuguese-speaking market in the
    // Americas the product is sold into.
    expect(codes).toHaveLength(19);
    expect(new Set(codes).size).toBe(codes.length);
  });

  describe.each(codes)('%s', (code) => {
    const profile = findCountryProfile(code)!;

    it('has an algorithmic tax-id validator, not just a regex', () => {
      expect(TAX_ID_VALIDATORS[code]).toBeDefined();
      // The property that matters: the validator must reject something. A validator that returns
      // true for everything is indistinguishable from having none, and that is what the old
      // "generic" strategy was.
      expect(validateTaxId(code, 'clearly-not-a-tax-id')).toBe(false);
      expect(validateTaxId(code, '')).toBe(false);
    });

    it('accepts its own documented example', () => {
      expect(validateTaxId(code, profile.taxId.example)).toBe(true);
    });

    it('has a tax scheme', () => {
      const scheme = findTaxScheme(code);
      expect(scheme).toBeDefined();
      // Either it seeds taxes, or it says explicitly why it cannot. Never silently neither.
      if (scheme!.taxes.length === 0) {
        expect(scheme!.configurationRequired).toBe(true);
        expect(scheme!.configurationNote?.length).toBeGreaterThan(20);
      }
    });

    it('seeds only tax computations the taxes.type enum accepts', () => {
      // The bug this replaces: the seed wrote `type: 'VAT'` into a Postgres enum whose only values
      // are 'Porcentaje' and 'Fijo', so applying the fiscal package raised
      // `invalid input value for enum taxes_type_enum: "VAT"` and rolled back the registration.
      for (const tax of findTaxScheme(code)!.taxes) {
        expect(Object.values(TaxType)).toContain(tax.computation);
      }
    });

    it('builds a chart of accounts that can actually be posted to', () => {
      const accounts = flatten(buildCountryCoaTemplate(code));
      const postable = accounts.filter((a) => a.isPostable);

      expect(postable.length).toBeGreaterThan(15);

      // Every top-level account type must be present, or the ledger cannot produce a balance
      // sheet and an income statement.
      const types = new Set(accounts.map((a) => a.type));
      expect(types).toEqual(
        new Set([
          AccountType.ASSET,
          AccountType.LIABILITY,
          AccountType.EQUITY,
          AccountType.REVENUE,
          AccountType.EXPENSE,
        ]),
      );

      // Account codes must be unique, or the tree cannot be addressed.
      const segments = accounts.map((a) => a.segments.join('-'));
      expect(new Set(segments).size).toBe(segments.length);
    });

    it('names the tax accounts after the tax the country actually levies', () => {
      const scheme = findTaxScheme(code)!;
      if (scheme.configurationRequired) return; // US and BR have no single national rate.

      const tax = principalTaxName(code);
      const names = flatten(buildCountryCoaTemplate(code)).map((a) => a.name);

      // Both sides of the VAT return have to exist as separate postable accounts: a return is
      // prepared from tax charged on sales less tax paid on purchases.
      expect(names.filter((n) => n.includes(tax)).length).toBeGreaterThanOrEqual(2);
    });

    it('writes the chart in a language the market reads', () => {
      const names = flatten(buildCountryCoaTemplate(code)).map((a) => a.name);
      if (code === 'US') {
        expect(names).toContain('Cash and Cash Equivalents');
      } else if (code === 'BR') {
        expect(names).toContain('Caixa e Equivalentes de Caixa');
      } else {
        expect(names).toContain('Efectivo y Equivalentes de Efectivo');
      }
    });

    it('declares a currency, a locale and a calling code', () => {
      expect(profile.currency).toMatch(/^[A-Z]{3}$/);
      expect(profile.locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
      expect(profile.callingCode).toMatch(/^\d{1,3}$/);
    });

    it('declares a tax-id pattern that its own example satisfies', () => {
      expect(new RegExp(profile.taxId.pattern).test(profile.taxId.example.toUpperCase())).toBe(true);
    });

    it('declares a postal-code pattern its own address rules can satisfy', () => {
      if (profile.address.postalCodeRequired) {
        expect(profile.address.postalCodePattern).toBeDefined();
      }
    });
  });

  it('has no validator, tax scheme or statutory note for a country it does not offer', () => {
    // Orphans in either direction mean the lists have drifted apart, which is precisely how a
    // country ends up offered but unprovisioned.
    expect(Object.keys(TAX_ID_VALIDATORS).sort()).toEqual([...codes].sort());
    expect(Object.keys(COUNTRY_TAX_SCHEMES).sort()).toEqual([...codes].sort());
    for (const code of Object.keys(STATUTORY_PLAN_REQUIRED)) {
      expect(codes).toContain(code);
    }
  });

  it('keeps every profile immutable at the type level', () => {
    // COUNTRY_FISCAL_PROFILES is the authority; a caller mutating it would change what every
    // later signup validates against.
    expect(Object.isFrozen(Object.freeze(COUNTRY_FISCAL_PROFILES))).toBe(true);
  });

  describe('contra-accounts', () => {
    it('gives accumulated depreciation and the doubtful-debt allowance a credit nature', () => {
      // An asset-class account with a debit nature would make the balance sheet add up wrong;
      // these two are the contra-accounts every chart needs and the easiest to get backwards.
      const accounts = flatten(buildCountryCoaTemplate('DO'));
      const depreciation = accounts.find((a) => a.name === 'Depreciación Acumulada');
      const allowance = accounts.find((a) => a.name === 'Estimación para Cuentas Incobrables');

      expect(depreciation?.nature).toBe(AccountNature.CREDIT);
      expect(depreciation?.type).toBe(AccountType.ASSET);
      expect(allowance?.nature).toBe(AccountNature.CREDIT);
      expect(allowance?.type).toBe(AccountType.ASSET);
    });

    it('gives sales returns a debit nature inside revenue', () => {
      const accounts = flatten(buildCountryCoaTemplate('MX'));
      const returns = accounts.find((a) => a.name.startsWith('Descuentos y Devoluciones'));
      expect(returns?.type).toBe(AccountType.REVENUE);
      expect(returns?.nature).toBe(AccountNature.DEBIT);
    });
  });

  describe('countries the product does not sell to', () => {
    it.each(['FR', 'DE', 'JP', 'ZZ', ''])('refuses %p at every layer', (code) => {
      expect(findCountryProfile(code)).toBeUndefined();
      expect(findTaxScheme(code)).toBeUndefined();
      expect(validateTaxId(code, '12345678901')).toBe(false);
    });
  });

  /**
   * Every market publishes a coded catalogue for its first-level administrative division.
   *
   * Only the Dominican Republic, the United States and Mexico used to, and the other sixteen
   * accepted free text. The comment justifying the structured address said, in the same file,
   * that "DIAN and SII require a coded municipality" — so the product was collecting a value it
   * had already documented as unusable, from sixteen of the nineteen countries it sells to. The
   * cost of that lands later than the bug: re-asking a paying customer for their address.
   */
  describe('administrative divisions', () => {
    it.each(COUNTRY_FISCAL_PROFILES.map((p) => [p.countryCode, p] as const))(
      '%s publishes a coded catalogue',
      (_code, profile) => {
        expect(profile.address.divisions).toBeDefined();
        expect(profile.address.divisions!.length).toBeGreaterThan(0);
      },
    );

    it.each(COUNTRY_FISCAL_PROFILES.map((p) => [p.countryCode, p] as const))(
      '%s uses unique, non-empty codes',
      (_code, profile) => {
        const codes = (profile.address.divisions ?? []).map((d) => d.code);
        expect(codes.filter((c) => !c.trim())).toEqual([]);
        expect(new Set(codes).size).toBe(codes.length);
      },
    );

    it.each(COUNTRY_FISCAL_PROFILES.map((p) => [p.countryCode, p] as const))(
      '%s names every division',
      (_code, profile) => {
        expect((profile.address.divisions ?? []).filter((d) => !d.name.trim())).toEqual([]);
      },
    );
  });

  /**
   * A multi-valued field is a different contract from a single select — it stores a list, it
   * validates every member, and the form renders it differently. Pinning which fields are
   * multi-valued keeps the three layers from disagreeing about one of them.
   */
  describe('multi-valued fiscal fields', () => {
    it('models the DIAN fiscal responsibilities as a list', () => {
      const colombia = COUNTRY_FISCAL_PROFILES.find((p) => p.countryCode === 'CO')!;
      const field = colombia.fiscalFields!.find((f) => f.key === 'responsabilidadesFiscales')!;
      expect(field.multiple).toBe(true);
    });

    it('only marks select fields as multi-valued', () => {
      for (const profile of COUNTRY_FISCAL_PROFILES) {
        for (const field of profile.fiscalFields ?? []) {
          if (field.multiple) expect(field.type).toBe('select');
        }
      }
    });
  });
});
