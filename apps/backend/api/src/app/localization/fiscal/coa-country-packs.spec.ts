import { AccountRole } from '../../contracts/accounting/account-role.contract';
import { AccountTemplateDto } from '../entities/coa-template.entity';
import { COUNTRY_SPECIFIC_COA_TERMS, buildCountryCoaTemplate } from './coa-builder';
import { serviceChargeRateFor, supportedCountryCodes } from './country-profiles';

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
  const countries = supportedCountryCodes();

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
      expect(Boolean(byRole(country, AccountRole.SERVICE_CHARGE_PAYABLE))).toBe(serviceChargeRateFor(country) > 0);
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
