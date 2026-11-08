import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { NeutralChartOfAccounts1789470000000 } from './migrations/1789470000000-NeutralChartOfAccounts';

/**
 * Tenants provisioned before the neutral chart are corrected in place, and only where nobody edited
 * the account (audit 2026-11-07, FIN-COA-03, LOC-02, I18N-05). Runs the migration's `up` against the
 * migrated schema with rows written the way the old template wrote them; `up` is idempotent.
 */
describeWithDb('NeutralChartOfAccounts migration', () => {
  let ds: DataSource;
  const orgs: Record<string, string> = {};

  const account = async (org: string, code: string, name: Record<string, string>, role: string | null, type = 'LIABILITY') => {
    const [row] = await ds.query(
      `INSERT INTO accounts (organization_id, code, name, type, category, nature, system_role, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id`,
      [org, code, JSON.stringify(name), type, type === 'EXPENSE' ? 'OPERATING_EXPENSE' : 'CURRENT_LIABILITY', type === 'EXPENSE' ? 'DEBIT' : 'CREDIT', role],
    );
    return row.id as string;
  };
  const read = async (id: string) =>
    (await ds.query(`SELECT name, system_role, fiscal_grouping_code FROM accounts WHERE id = $1`, [id]))[0];

  beforeAll(async () => {
    ds = await openTestDataSource();
    for (const [country, language] of [['DO', 'es'], ['MX', 'es'], ['BR', 'pt'], ['US', 'en']] as const) {
      orgs[country] = await createTestOrganization(ds, `QA-coa-${country}`);
      await ds.query(`UPDATE organizations SET country = $2, books_language = $3 WHERE id = $1`, [orgs[country], country, language]);
    }
  });

  afterAll(async () => {
    for (const country of ['DO', 'MX', 'BR']) await ds.query(`DELETE FROM organizations WHERE id = $1`, [orgs[country]]);
    await dropTestOrganization(ds, orgs['US']);
  });

  it('renames Dominican institutions outside DO, keeps them in DO, and keeps edited names', async () => {
    const doAfp = await account(orgs['DO'], '2141', { es: 'AFP por Pagar (TSS)' }, 'AFP_PAYABLE');
    const mxAfp = await account(orgs['MX'], '2141', { es: 'AFP por Pagar (TSS)' }, 'AFP_PAYABLE');
    const mxEdited = await account(orgs['MX'], '2142', { es: 'Mi cuenta IMSS' }, 'SFS_PAYABLE');
    const mxIsc = await account(orgs['MX'], '2165', { es: 'Impuesto Selectivo al Consumo por Pagar' }, 'EXCISE_TAX_PAYABLE');
    const mxTip = await account(orgs['MX'], '2160', { es: 'Propina Legal por Pagar' }, 'SERVICE_CHARGE_PAYABLE');
    const mxAr = await account(orgs['MX'], '1130', { es: 'Cuentas por Cobrar Comerciales' }, 'ACCOUNTS_RECEIVABLE', 'ASSET');

    const runner = ds.createQueryRunner();
    try {
      await new NeutralChartOfAccounts1789470000000().up(runner);
    } finally {
      await runner.release();
    }

    expect(await read(doAfp)).toMatchObject({ name: { es: 'AFP por Pagar (TSS)' }, system_role: 'PENSION_CONTRIBUTIONS_PAYABLE' });
    expect(await read(mxAfp)).toMatchObject({
      name: { es: 'Aportaciones SAR (Retiro, Cesantía y Vejez) por Pagar' },
      system_role: 'PENSION_CONTRIBUTIONS_PAYABLE',
      fiscal_grouping_code: '211',
    });
    expect(await read(mxEdited)).toMatchObject({ name: { es: 'Mi cuenta IMSS' }, system_role: 'HEALTH_CONTRIBUTIONS_PAYABLE' });
    expect((await read(mxIsc)).name).toEqual({ es: 'IEPS por Pagar' });
    expect((await read(mxTip)).name).toEqual({ es: 'Cargos por Servicio por Pagar' });
    expect((await read(mxAr)).fiscal_grouping_code).toBe('105');
  });

  it('moves names stored under `es` to the books language, and Portuguese tax accounts off the Spanish fallback', async () => {
    const brTax = await account(orgs['BR'], '1150', { es: 'Impuesto a Recuperar' }, 'TAX_RECEIVABLE', 'ASSET');
    const usCash = await account(orgs['US'], '1110', { es: 'Cash and Cash Equivalents' }, 'CASH', 'ASSET');
    const usBilingual = await account(orgs['US'], '1120', { es: 'Bancos', en: 'Bank Accounts' }, 'BANK', 'ASSET');

    const runner = ds.createQueryRunner();
    try {
      await new NeutralChartOfAccounts1789470000000().up(runner);
    } finally {
      await runner.release();
    }

    expect((await read(brTax)).name).toEqual({ pt: 'Tributos a Recuperar' });
    expect((await read(usCash)).name).toEqual({ en: 'Cash and Cash Equivalents' });
    expect((await read(usBilingual)).name).toEqual({ es: 'Bancos', en: 'Bank Accounts' });
  });
});
