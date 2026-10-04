import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { OrganizationSettings } from './entities/organization-settings.entity';
import { OrgSettingsService } from './services/org-settings.service';
import { OrganizationSettingsSectionsService } from './services/organization-settings-sections.service';

/** «Configuración» sections that said «En desarrollo» edit the real settings row (QA M-09). */
describeWithDb('organization settings sections', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let service: OrganizationSettingsSectionsService;
  let organizationId: string;
  let otherOrganizationId: string;
  const account: Record<string, string> = {};

  async function addAccount(org: string, code: string, type: string, postable = true): Promise<string> {
    const [row] = await dataSource.query(
      `INSERT INTO accounts (organization_id, code, name, type, category, nature, version, "isPostable")
       VALUES ($1, $2, '{"es":"Cuenta"}', $3::accounts_type_enum,
               (CASE $3 WHEN 'ASSET' THEN 'CURRENT_ASSET' WHEN 'LIABILITY' THEN 'CURRENT_LIABILITY'
                        WHEN 'EQUITY' THEN 'OWNERS_EQUITY' WHEN 'REVENUE' THEN 'OPERATING_REVENUE'
                        ELSE 'OPERATING_EXPENSE' END)::accounts_category_enum,
               (CASE WHEN $3 IN ('ASSET','EXPENSE') THEN 'DEBIT' ELSE 'CREDIT' END)::accounts_nature_enum,
               1, $4) RETURNING id`,
      [org, code, type, postable],
    );
    return row.id;
  }

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'Settings');
    otherOrganizationId = await createTestOrganization(dataSource, 'Settings other');
    for (const org of [organizationId, otherOrganizationId]) {
      await dataSource.query(`INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'DOP')`, [org]);
    }
    account['receivable'] = await addAccount(organizationId, '1102', 'ASSET');
    account['revenue'] = await addAccount(organizationId, '4101', 'REVENUE');
    account['header'] = await addAccount(organizationId, '1100', 'ASSET', false);
    account['foreign'] = await addAccount(otherOrganizationId, '1102', 'ASSET');
    service = new OrganizationSettingsSectionsService(
      dataSource.getRepository(OrganizationSettings),
      new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
      dataSource,
    );
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM organizations WHERE id = $1', [otherOrganizationId]);
    await dropTestOrganization(dataSource, organizationId);
  });

  it('sets a default account and reads it back, named', async () => {
    const view = await service.update('accounting', organizationId, {
      accounts: { defaultAccountsReceivableId: account['receivable'] },
      fields: { defaultPaymentTermDays: 45 },
    });
    expect(view.accounts['defaultAccountsReceivableId']).toEqual(expect.objectContaining({ code: '1102' }));
    expect(view.fields['defaultPaymentTermDays']).toBe(45);
    expect(view.expectedTypes['defaultAccountsReceivableId']).toBe('ASSET');
  });

  it('refuses an account of the wrong type, a header account, and another tenant’s account', async () => {
    await expect(
      service.update('accounting', organizationId, { accounts: { defaultAccountsReceivableId: account['revenue'] } }),
    ).rejects.toMatchObject({ messageKey: 'organizations.settings.account_wrong_type' });
    await expect(
      service.update('accounting', organizationId, { accounts: { defaultAccountsReceivableId: account['header'] } }),
    ).rejects.toMatchObject({ messageKey: 'organizations.settings.account_not_usable' });
    await expect(
      service.update('accounting', organizationId, { accounts: { defaultAccountsReceivableId: account['foreign'] } }),
    ).rejects.toMatchObject({ messageKey: 'organizations.settings.account_not_usable' });
    await expect(
      service.update('accounting', organizationId, { accounts: { defaultAccountsReceivableId: 'not-a-uuid' } }),
    ).rejects.toMatchObject({ messageKey: 'organizations.settings.account_not_usable' });
  });

  it('keeps each section to its own columns and its own rules', async () => {
    await expect(
      service.update('taxes', organizationId, { accounts: { defaultAccountsReceivableId: account['receivable'] } }),
    ).rejects.toMatchObject({ messageKey: 'organizations.settings.unknown_field' });
    await expect(
      service.update('currencies', organizationId, { fields: { fxRateTolerance: 5 } }),
    ).rejects.toMatchObject({ messageKey: 'organizations.settings.number_between' });
    await expect(service.get('nonsense', organizationId)).rejects.toMatchObject({
      messageKey: 'organizations.settings.unknown_section',
    });
  });

  it('lets the base currency change only before there are books', async () => {
    const changed = await service.update('currencies', organizationId, { baseCurrency: 'usd' });
    expect(changed.baseCurrency).toEqual({ code: 'USD', locked: false });

    const [ledger] = await dataSource.query(
      `INSERT INTO ledgers (organization_id, name, currency) VALUES ($1, 'Principal', 'USD') RETURNING id`,
      [organizationId],
    );
    const [journal] = await dataSource.query(
      `INSERT INTO journals (organization_id, code, name, type) VALUES ($1, 'GENERAL', 'General', 'GENERAL') RETURNING id`,
      [organizationId],
    );
    await dataSource.query(
      `INSERT INTO journal_entries (id, organization_id, ledger_id, journal_id, date, description)
       VALUES ($1, $2, $3, $4, '2026-09-01', 'Apertura')`,
      [await newId(dataSource), organizationId, ledger.id, journal.id],
    );
    await expect(service.update('currencies', organizationId, { baseCurrency: 'DOP' })).rejects.toMatchObject({
      messageKey: 'organizations.settings.base_currency_locked',
    });
    expect((await service.get('currencies', organizationId)).baseCurrency).toEqual({ code: 'USD', locked: true });
  });
});
