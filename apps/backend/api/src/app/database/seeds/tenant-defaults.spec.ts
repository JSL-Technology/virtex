import esCatalogue from '../../i18n/messages/es.json';
import enCatalogue from '../../i18n/messages/en.json';
import ptCatalogue from '../../i18n/messages/pt.json';
import { SeedLanguage, SqlRunner, TenantDefaultsContext, seedTenantDefaults } from './tenant-defaults';

const CATALOGUES: Record<SeedLanguage, Record<string, string>> = {
  es: esCatalogue,
  en: enCatalogue,
  pt: ptCatalogue,
};
const translate = (key: string, language: SeedLanguage) => CATALOGUES[language][key] ?? key;

/** Records every statement, so the seed's per-market output can be read without a database. */
function recorder() {
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const runner: SqlRunner = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      return [];
    },
  };
  const into = (table: string) => statements.filter((s) => s.sql.includes(`INSERT INTO "${table}"`));
  return { runner, statements, into };
}

const context = (country: string, booksLanguage: string): TenantDefaultsContext => ({
  organizationId: '00000000-0000-0000-0000-000000000001',
  country,
  booksLanguage,
  baseCurrency: country === 'US' ? 'USD' : 'DOP',
  cashAccountId: null,
});

/**
 * The defaults a company starts with, per market (QA C-06).
 *
 * The seed is the one provisioning runs inside the signup transaction and the backfill migration
 * runs for existing tenants; what it writes is what each market's company finds on day one.
 */
describe('tenant defaults seed', () => {
  it('gives a US company a walk-in customer, its own editable payment methods and FICA/Medicare/FUTA', async () => {
    const { runner, into } = recorder();
    await seedTenantDefaults(runner, context('US', 'en'), translate);

    const customer = into('customers')[0];
    expect(customer.params[1]).toBe('Walk-in customer');

    const methods = into('payment_methods');
    expect(methods.map((m) => m.params[1])).toEqual(['ACH', 'WIRE', 'CHECK', 'CARD', 'ZELLE', 'CASH', 'ON_ACCOUNT']);
    // Editable: none of them is the authority's.
    expect(methods.every((m) => m.params[5] === false)).toBe(true);
    expect(methods[0].params[2]).toBe('ACH transfer');

    const parameters = into('payroll_company_parameters');
    expect(parameters.map((p) => p.params[2])).toEqual(
      expect.arrayContaining(['FICA_SOCIAL_SECURITY', 'FICA_MEDICARE', 'FICA_MEDICARE_ADDITIONAL', 'FUTA']),
    );
    const fica = parameters.find((p) => p.params[2] === 'FICA_SOCIAL_SECURITY')!;
    expect(fica.params.slice(5, 8)).toEqual([0.062, 0.062, 184_500]);
    expect(fica.params[11]).toBe('USD');

    const concepts = into('payroll_concepts').map((c) => c.params[1]);
    expect(concepts).toEqual(expect.arrayContaining(['SS', 'MEDICARE', 'FIT', 'FUTA']));
    expect(concepts).not.toContain('AFP');
  });

  it('keeps the Dominican defaults: Consumidor final, the DGII codes locked, AFP/SFS/ISR, no company parameters', async () => {
    const { runner, into } = recorder();
    await seedTenantDefaults(runner, context('DO', 'es'), translate);

    expect(into('customers')[0].params[1]).toBe('Consumidor final');
    const methods = into('payment_methods');
    expect(methods.map((m) => m.params[1])).toEqual(['01', '02', '03', '04', '05', '06', '07']);
    expect(methods.every((m) => m.params[5] === true)).toBe(true);
    expect(into('payroll_company_parameters')).toHaveLength(0);
    expect(into('payroll_concepts').map((c) => c.params[1])).toEqual(expect.arrayContaining(['AFP', 'SFS', 'ISR']));
  });

  it('names the Mexican anonymous buyer «Público en general» and maps payment methods to c_FormaPago', async () => {
    const { runner, into } = recorder();
    await seedTenantDefaults(runner, context('MX', 'es'), translate);
    expect(into('customers')[0].params[1]).toBe('Público en general');
    const transfer = into('payment_methods').find((m) => m.params[3] === 'BANK_TRANSFER')!;
    expect(transfer.params[4]).toBe('03');
  });

  it('writes Brazilian names in Brazilian Portuguese', async () => {
    const { runner, into } = recorder();
    await seedTenantDefaults(runner, context('BR', 'pt'), translate);
    expect(into('customers')[0].params[1]).toBe('Consumidor final');
    expect(into('payment_methods').map((m) => m.params[2])).toContain('Boleto bancário');
  });

  it('is idempotent by construction: every insert is guarded', async () => {
    const { runner, statements } = recorder();
    await seedTenantDefaults(runner, context('US', 'en'), translate);
    const inserts = statements.filter((s) => s.sql.includes('INSERT INTO'));
    for (const insert of inserts) {
      expect(insert.sql).toMatch(/ON CONFLICT|WHERE NOT EXISTS/);
    }
  });
});
