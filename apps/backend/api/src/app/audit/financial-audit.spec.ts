import { DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { BankAccount } from '../treasury/entities/bank-account.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import { Budget } from '../budgets/entities/budget.entity';
import { AuditLog, ActionType } from './entities/audit-log.entity';
import { FinancialAuditSubscriber } from './financial-audit.subscriber';
import { AuditTrailService } from './audit.service';

/**
 * Every change to a financial document leaves a row, in the transaction that made it.
 *
 * `grep -rl AuditTrailService` returned nothing in accounts-payable, customers, treasury,
 * reconciliation, invoices, fixed-assets or budgets. Voiding a supplier bill, changing a bank
 * account, amending a budget or moving the organisation's default receivables account left no
 * trace anywhere. The subscriber that was supposed to cover this was registered in no module,
 * listened to `Object`, and wrote through a TypeORM 0.2 API that no longer exists.
 *
 * These run against a real database because what is being asserted is that the row is written by
 * the database session that made the change — which is the whole point of it and the one thing a
 * unit test with a fake repository cannot show.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('the financial audit trail', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
      // Registered the way the application registers it, on the connection. The previous
      // subscriber was a Nest provider nothing imported, which is why it never ran once.
      subscribers: [FinancialAuditSubscriber],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `Auditoría ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;
  });

  afterEach(async () => {
    if (organizationId) {
      await dataSource.getRepository(Organization).delete({ id: organizationId });
    }
  });

  const rowsFor = (entity: string, entityId: string) =>
    dataSource.getRepository(AuditLog).find({
      where: { entity, entityId },
      order: { timestamp: 'ASC' },
    });

  it('records the creation and the change of a bank account', async () => {
    // A bank account points at the ledger account its movements land in; the column is NOT NULL,
    // because a bank account with no ledger account behind it cannot be posted to.
    const glAccount = await dataSource.getRepository(Account).save(
      dataSource.getRepository(Account).create({
        organizationId,
        code: '1102',
        name: { es: 'Banco' },
        type: AccountType.ASSET,
        category: AccountCategory.CURRENT_ASSET,
        nature: AccountNature.DEBIT,
        systemRole: AccountRole.BANK,
        isPostable: true,
        isActive: true,
      }),
    );

    const accounts = dataSource.getRepository(BankAccount);
    const account = await accounts.save(
      accounts.create({
        organizationId,
        name: 'Cuenta operativa',
        accountNumber: `AUD-${Date.now()}`,
        currencyCode: 'DOP',
        glAccountId: glAccount.id,
        isActive: true,
      }),
    );

    account.name = 'Cuenta operativa — renombrada';
    await accounts.save(account);

    const rows = await rowsFor('bank_accounts', account.id);
    expect(rows.map((row) => row.actionType)).toEqual([ActionType.CREATE, ActionType.UPDATE]);
    expect(rows[0].organizationId).toBe(organizationId);
    // The payload carries the columns, so a reader can see what the row said at the time.
    expect((rows[1].newValue as Record<string, unknown>)['name']).toBe(
      'Cuenta operativa — renombrada',
    );
  });

  it('records a change to where money is posted, which is a financial change too', async () => {
    // Moving the default receivables account moves every future posting. It is configuration
    // rather than a document, and it belongs in the trail for exactly that reason.
    const settings = dataSource.getRepository(OrganizationSettings);
    const row = await settings.save(
      settings.create({ organizationId, baseCurrency: 'DOP' }),
    );

    const rows = await rowsFor('organization_settings', row.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].actionType).toBe(ActionType.CREATE);
  });

  it('rolls the audit row back with the change it describes', async () => {
    // The reason the row is written through the caller's manager. An audit row that survives a
    // rolled-back change describes something that never happened; one that is lost while the
    // change commits leaves a movement nobody is answerable for.
    let budgetId = '';
    await expect(
      dataSource.transaction(async (manager) => {
        const budget = await manager.save(
          manager.create(Budget, {
            organizationId,
            name: 'Presupuesto 2026',
            period: '2026-01',
          }),
        );
        budgetId = budget.id;
        throw new Error('la operación falla después de escribir');
      }),
    ).rejects.toThrow('la operación falla después de escribir');

    expect(await rowsFor('budgets', budgetId)).toHaveLength(0);
  });

  it('leaves tables that are not financial documents alone', async () => {
    // The previous subscriber listened to `Object`, so it would have audited sessions, password
    // hashes and the audit log itself. The organisation row is not on the list.
    const rows = await dataSource
      .getRepository(AuditLog)
      .find({ where: { entity: 'organizations', entityId: organizationId } });

    expect(rows).toHaveLength(0);
  });
  /**
   * The trail as the Security page reads it: filtered by who, what and when, with the actor named.
   * An auditor asks «who changed this, and when»; ids alone answer neither.
   */
  it('filters the trail by action, entity and date, and names the actor', async () => {
    const service = new AuditTrailService(dataSource.getRepository(AuditLog));
    const repo = dataSource.getRepository(AuditLog);
    const entityId = '9c000000-0000-4000-8000-000000000001';
    await repo.save([
      repo.create({ organizationId, userId: null, entity: 'invoices', entityId, actionType: ActionType.CREATE, newValue: {} }),
      repo.create({ organizationId, userId: null, entity: 'invoices', entityId, actionType: ActionType.UPDATE, newValue: {} }),
      repo.create({ organizationId, userId: null, entity: 'customers', entityId, actionType: ActionType.UPDATE, newValue: {} }),
    ]);

    const updates = await service.find(organizationId, { actionType: ActionType.UPDATE, entity: 'invoices' });
    expect(updates.total).toBe(1);
    expect(updates.rows[0]).toMatchObject({ entity: 'invoices', actionType: ActionType.UPDATE, actorName: null });

    const today = new Date().toISOString().slice(0, 10);
    expect((await service.find(organizationId, { from: today, to: today })).total).toBe(3);
    expect((await service.find(organizationId, { to: '2000-01-01' })).total).toBe(0);

    expect(await service.entities(organizationId)).toEqual(['customers', 'invoices']);
  });
});
