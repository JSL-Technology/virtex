import { AccountRole } from '../../contracts/accounting/account-role.contract';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { COUNTRY_SPECIFIC_COA_TERMS, buildCountryCoaTemplate } from './coa-builder';
import { marketCodes, marketFor } from '../../markets';
import { SUPPORTED_LANGUAGES } from '@virtex/shared/types';

/**
 * The opening chart is neutral, and a country's institutions reach only that country's tenants
 * (audit 2026-11-07, FIN-COA-03, LOC-02, SP-02).
 *
 * The plan used to give every Spanish-speaking market the Dominican social-security funds (AFP, SFS,
 * SRL, INFOTEP, TSS), the Dominican legal tip and the ISC; a Mexican ledger had no IEPS. These tests
 * run over every supported market so the next pilot market cannot become everyone's default again.
 */
function flatten(template: AccountTemplateDto[]): AccountTemplateDto[] {
  return template.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

const byRole = (country: string, role: AccountRole) =>
  flatten(buildCountryCoaTemplate(country)).find((account) => account.systemRole === role);

describe('chart-of-accounts country packs', () => {
  const countries = [...marketCodes()];

  describe.each(countries)('%s', (country) => {
    const names = flatten(buildCountryCoaTemplate(country)).map((account) => account.name);

    it("carries no other market's institutions", () => {
      for (const [owner, terms] of Object.entries(COUNTRY_SPECIFIC_COA_TERMS)) {
        if (owner === country) continue;
        for (const term of terms) {
          expect(names.filter((name) => term.test(name))).toEqual([]);
        }
      }
    });

    it('has every payroll role, so a payroll run can post in any market', () => {
      for (const role of [
        AccountRole.PENSION_CONTRIBUTIONS_PAYABLE,
        AccountRole.HEALTH_CONTRIBUTIONS_PAYABLE,
        AccountRole.OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE,
        AccountRole.PAYROLL_TAX_WITHHOLDING_PAYABLE,
        AccountRole.EMPLOYER_CONTRIBUTIONS_EXPENSE,
        AccountRole.EXCISE_TAX_PAYABLE,
      ]) {
        expect(byRole(country, role)).toBeDefined();
      }
    });

    it('opens a service-charge account only where the profile levies one', () => {
      expect(Boolean(byRole(country, AccountRole.SERVICE_CHARGE_PAYABLE))).toBe(marketFor(country).taxes.serviceChargeRate > 0);
    });

    /**
     * Each account states how its foreign-currency balances are measured (FIN-AC-03, IAS 21.23):
     * money restated at the closing rate, everything else at the rate of its day.
     */
    it('revalues the money and nothing else, and keeps the unrealised differences apart', () => {
      const accounts = flatten(buildCountryCoaTemplate(country));
      const treatment = (role: AccountRole) => byRole(country, role)?.fxTreatment;

      for (const role of [AccountRole.CASH, AccountRole.BANK, AccountRole.ACCOUNTS_RECEIVABLE, AccountRole.ACCOUNTS_PAYABLE, AccountRole.TAX_PAYABLE]) {
        expect([role, treatment(role)]).toEqual([role, 'REVALUED']);
      }
      // An advance settled by delivering goods is not money (IFRIC 22), nor is stock.
      expect(treatment(AccountRole.CUSTOMER_ADVANCES)).toBe('HISTORICAL');
      expect(treatment(AccountRole.INVENTORY)).toBe('HISTORICAL');
      // Only balance-sheet accounts are revalued, and no heading: it carries no balance of its own.
      expect(accounts.filter((a) => a.fxTreatment === 'REVALUED' && !['ASSET', 'LIABILITY'].includes(a.type))).toEqual([]);
      expect(accounts.filter((a) => !a.isPostable && a.fxTreatment !== 'HISTORICAL')).toEqual([]);

      // Where the period-end revaluation posts, apart from the realised differences.
      const unrealised = byRole(country, AccountRole.UNREALIZED_FOREX_GAIN_LOSS);
      expect(unrealised).toMatchObject({ isPostable: true, fxTreatment: 'HISTORICAL' });
      expect(unrealised?.segments).not.toEqual(byRole(country, AccountRole.FOREX_GAIN_LOSS)?.segments);
    });

    it('hangs every account under a heading of its own type', () => {
      const check = (nodes: AccountTemplateDto[], parent: AccountTemplateDto | null): void => {
        for (const node of nodes) {
          const code = node.segments.join('-');
          if (parent) expect([code, node.type, parent.isPostable]).toEqual([code, parent.type, false]);
          check(node.children ?? [], node);
        }
      };
      check(buildCountryCoaTemplate(country), null);
    });
  });

  it('keeps the Dominican institutions in the Dominican plan', () => {
    expect(byRole('DO', AccountRole.PENSION_CONTRIBUTIONS_PAYABLE)?.name).toBe('AFP por Pagar (TSS)');
    expect(byRole('DO', AccountRole.HEALTH_CONTRIBUTIONS_PAYABLE)?.name).toBe('SFS por Pagar (TSS)');
    expect(byRole('DO', AccountRole.OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE)?.name).toBe('SRL e INFOTEP por Pagar');
    expect(byRole('DO', AccountRole.SERVICE_CHARGE_PAYABLE)?.name).toBe('Propina Legal por Pagar');
    expect(byRole('DO', AccountRole.TAX_PAYABLE)?.name).toContain('ITBIS');
  });

  it("names Mexico's own funds and excise, and gives every Mexican template account a SAT grouping code where one is declared", () => {
    expect(byRole('MX', AccountRole.HEALTH_CONTRIBUTIONS_PAYABLE)?.name).toBe('Cuotas IMSS por Pagar');
    expect(byRole('MX', AccountRole.EXCISE_TAX_PAYABLE)?.name).toBe('IEPS por Pagar');
    expect(byRole('MX', AccountRole.ACCOUNTS_RECEIVABLE)?.fiscalGroupingCode).toBe('105');
    expect(byRole('MX', AccountRole.TAX_PAYABLE)?.fiscalGroupingCode).toBe('208');
    // Only Mexico's catalogue requires the code; nobody else receives a SAT code.
    expect(byRole('CO', AccountRole.ACCOUNTS_RECEIVABLE)?.fiscalGroupingCode).toBeUndefined();
  });

  it('gives a market with no pack the neutral names', () => {
    expect(byRole('UY', AccountRole.PENSION_CONTRIBUTIONS_PAYABLE)?.name).toBe('Aportes de Pensión por Pagar');
    expect(byRole('UY', AccountRole.EXCISE_TAX_PAYABLE)?.name).toBe('Impuestos Específicos al Consumo por Pagar');
  });

  it('names Brazilian tax accounts in Portuguese even with no seeded taxes (I18N-05)', () => {
    expect(byRole('BR', AccountRole.TAX_RECEIVABLE)?.name).toBe('Tributos a Recuperar');
  });
});

/**
 * The plan in every language the product speaks (books bilingual).
 *
 * Every account was named in the books language only: a US controller of a Dominican company read
 * the interface in English and the whole chart in Spanish. The books keep their language — it is
 * the record — and every other one comes with the plan.
 */
describe('the opening chart in every language', () => {
  it.each([...marketCodes()])('%s: every account has its name in each language but the books one, which is the name itself', (country) => {
    const books = marketFor(country).profile?.booksLanguage ?? 'es';
    for (const account of flatten(buildCountryCoaTemplate(country))) {
      const code = account.segments.join('');
      expect([code, account.translations?.[books]]).toEqual([code, undefined]);
      for (const language of SUPPORTED_LANGUAGES.filter((candidate) => candidate !== books)) {
        expect([code, language, Boolean(account.translations?.[language]?.trim())]).toEqual([code, language, true]);
      }
    }
  });

  it('a Dominican plan reads in English and Portuguese, its own institutions said for what they are', () => {
    const bank = byRole('DO', AccountRole.BANK)!;
    expect([bank.name, bank.translations]).toEqual(['Bancos', { en: 'Bank Accounts', pt: 'Bancos' }]);
    const pension = byRole('DO', AccountRole.PENSION_CONTRIBUTIONS_PAYABLE)!;
    expect(pension.name).toBe('AFP por Pagar (TSS)');
    expect(pension.translations).toEqual({ en: 'Pension Contributions Payable', pt: 'Previdência a Recolher' });
    // The tax is the market's, in every language.
    expect(byRole('DO', AccountRole.TAX_PAYABLE)!.translations?.en).toBe('ITBIS Payable');
  });

  it('a plan kept in Portuguese or in English reads in the other two', () => {
    expect(byRole('BR', AccountRole.TAX_RECEIVABLE)?.translations).toEqual(
      expect.objectContaining({ es: expect.any(String), en: expect.any(String) }),
    );
    expect(byRole('US', AccountRole.BANK)?.translations).toEqual({ es: 'Bancos', pt: 'Bancos' });
  });

  it('carries no other market\'s institutions in any language either', () => {
    for (const country of marketCodes()) {
      const translated = flatten(buildCountryCoaTemplate(country)).flatMap((account) => Object.values(account.translations ?? {}));
      for (const [owner, terms] of Object.entries(COUNTRY_SPECIFIC_COA_TERMS)) {
        if (owner === country) continue;
        for (const term of terms) expect([country, owner, translated.filter((name) => term.test(name))]).toEqual([country, owner, []]);
      }
    }
  });
});
