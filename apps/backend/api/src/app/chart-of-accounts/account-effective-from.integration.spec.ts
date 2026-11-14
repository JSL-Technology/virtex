import { DataSource } from 'typeorm';
import { ChartOfAccountsService } from './chart-of-accounts.service';
import { TemporalValidityGuard } from '../financial-reporting/guards/temporal-validity.guard';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * A company that opens its books in November can post what it has already done this year
 * (FIN-COA-01), and the guard that enforces the window reads only its own accounts.
 *
 * The opening chart is written the moment the company signs up and `accounts.effective_from`
 * defaulted to `CURRENT_DATE`, so every account was valid only from that day: a journal entry dated
 * earlier in the same open fiscal year was refused with 403 on the first account it touched, and
 * the only way out of the product was to edit all fifty-six accounts by hand. Against the migrated
 * schema, because the defect was the column's default and nothing a mocked repository would show.
 */
describeWithDb('an account is valid from the start of the open fiscal year', () => {
  let ds: DataSource;
  let organizationId: string;
  let otherOrganizationId: string;
  const year = new Date().getUTCFullYear();

  const context = (body: unknown, orgId: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ body, user: { organizationId: orgId } }) }),
    }) as never;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'coa-effective');
    otherOrganizationId = await createTestOrganization(ds, 'coa-effective-other');
    // The company's calendar: the year already under way, open.
    await ds.query(
      `INSERT INTO fiscal_years (organization_id, start_date, end_date, status) VALUES ($1, $2, $3, 'OPEN')`,
      [organizationId, `${year}-01-01`, `${year}-12-31`],
    );
  });

  afterAll(async () => {
    if (ds?.isInitialized && otherOrganizationId) {
      await ds.query(`DELETE FROM organizations WHERE id = $1`, [otherOrganizationId]);
    }
    await dropTestOrganization(ds, organizationId);
  });

  it('resolves the date from the oldest OPEN year, not from today', async () => {
    await expect(ChartOfAccountsService.defaultEffectiveFrom(ds.manager, organizationId)).resolves.toBe(`${year}-01-01`);
  });

  it('a year that is closed does not pull the date forward', async () => {
    // A tenant whose previous year is still open may post in it; a closed one is not a candidate.
    await ds.query(
      `INSERT INTO fiscal_years (organization_id, start_date, end_date, status) VALUES ($1, $2, $3, 'CLOSED')`,
      [organizationId, `${year - 2}-01-01`, `${year - 2}-12-31`],
    );
    await expect(ChartOfAccountsService.defaultEffectiveFrom(ds.manager, organizationId)).resolves.toBe(`${year}-01-01`);

    await ds.query(
      `INSERT INTO fiscal_years (organization_id, start_date, end_date, status) VALUES ($1, $2, $3, 'OPEN')`,
      [organizationId, `${year - 1}-01-01`, `${year - 1}-12-31`],
    );
    await expect(ChartOfAccountsService.defaultEffectiveFrom(ds.manager, organizationId)).resolves.toBe(`${year - 1}-01-01`);
    await ds.query(`DELETE FROM fiscal_years WHERE organization_id = $1 AND start_date <> $2`, [organizationId, `${year}-01-01`]);
  });

  it('with no fiscal calendar yet it is the first day of the tenant year — provisioning writes the chart first', async () => {
    const fresh = await createTestOrganization(ds, 'coa-effective-fresh');
    try {
      await expect(ChartOfAccountsService.defaultEffectiveFrom(ds.manager, fresh)).resolves.toMatch(/^\d{4}-01-01$/);
    } finally {
      await ds.query(`DELETE FROM organizations WHERE id = $1`, [fresh]);
    }
  });

  describe('the guard that enforces the window', () => {
    const guard = () => new TemporalValidityGuard(ds);
    let accountId: string;

    beforeAll(async () => {
      const [row] = await ds.query(
        `INSERT INTO accounts (organization_id, code, name, type, category, nature, "isPostable", version, effective_from)
         VALUES ($1, '1110', '{"es":"Caja"}'::jsonb, 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 1, $2) RETURNING id`,
        [organizationId, `${year}-01-01`],
      );
      accountId = row.id;
    });

    it('admits an entry dated earlier in the open year', async () => {
      const body = { date: `${year}-01-15`, lines: [{ accountId }] };
      await expect(guard().canActivate(context(body, organizationId))).resolves.toBe(true);
    });

    it('admits an entry dated the very first day it is valid, whatever offset the date carries', async () => {
      // `2026-01-01T00:00:00-04:00` is the 1st in Santo Domingo and the 1st in the books; comparing
      // instants made it 04:00 UTC, later than the account's midnight, and refused the entry.
      const body = { date: `${year}-01-01T00:00:00-04:00`, lines: [{ accountId }] };
      await expect(guard().canActivate(context(body, organizationId))).resolves.toBe(true);
    });

    it('refuses an entry dated before the account exists', async () => {
      const body = { date: `${year - 1}-12-31`, lines: [{ accountId }] };
      await expect(guard().canActivate(context(body, organizationId))).rejects.toMatchObject({
        messageKey: 'financial_reporting.account_code_not_valid_until_effective',
      });
    });

    it("refuses an account that is not this company's instead of waving it through", async () => {
      const body = { date: `${year}-06-01`, lines: [{ accountId }] };
      await expect(guard().canActivate(context(body, otherOrganizationId))).rejects.toMatchObject({
        messageKey: 'financial_reporting.account_not_in_this_company',
      });
    });
  });
});
