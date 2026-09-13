import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Organization } from '../organizations/entities/organization.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Account } from '../chart-of-accounts/entities/account.entity';
import {
  AccountCategory,
  AccountNature,
  AccountRole,
  AccountType,
} from '../chart-of-accounts/enums/account-enums';
import {
  AccountingPeriod,
  PeriodStatus,
} from '../accounting/entities/accounting-period.entity';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';
import { JournalEntryAttachment } from '../journal-entries/entities/journal-entry-attachment.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { JournalEntryNumberingService } from '../journal-entries/journal-entry-numbering.service';
import { AuditTrailService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AccountBalancesService } from '../chart-of-accounts/account-balances.service';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { Product, ProductKind } from './entities/product.entity';
import { InventoryService } from './inventory.service';
import { InventoryPostingService } from './inventory-posting.service';
import { ProductCategoriesService } from './product-categories.service';
import { ProductCategory } from './entities/product-category.entity';

/**
 * Stock is an asset, and this is what makes the books say so.
 *
 * A product could be created holding 50 units at 400 each with no entry anywhere: 20,000 of real
 * goods in the warehouse and nothing on the balance sheet. The first sale then credited the
 * inventory account for its cost and drove it *negative* — an asset reported below zero.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('inventory posting', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let inventory: InventoryService;
  let balances: AccountBalancesService;

  let organizationId: string;
  let ledgerId: string;
  const account: Record<string, string> = {};

  const ACTOR = '44444444-4444-4444-8444-444444444444';

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
    });
    await dataSource.initialize();

    balances = new AccountBalancesService(dataSource);
    const entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      new ExchangeRateResolver(dataSource),
    );

    inventory = new InventoryService(
      dataSource.getRepository(Product),
      dataSource,
      new InventoryPostingService(entries),
      // The real category service: a product's category must belong to this tenant and still be
      // offered, and that check is part of what creating a product means now.
      new ProductCategoriesService(
        dataSource.getRepository(ProductCategory),
        dataSource.getRepository(Product),
      ),
    );
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    const org = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `INV ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    organizationId = org.id;

    const ledger = await dataSource.getRepository(Ledger).save(
      dataSource.getRepository(Ledger).create({
        organizationId,
        name: 'Principal',
        currency: 'DOP',
        isDefault: true,
        isActive: true,
      }),
    );
    ledgerId = ledger.id;

    await dataSource.getRepository(Journal).save([
      { organizationId, code: 'GENERAL', name: 'General', type: 'GENERAL' as const },
    ]);

    const make = async (
      key: string,
      code: string,
      type: AccountType,
      category: AccountCategory,
      nature: AccountNature,
      systemRole: AccountRole,
    ) => {
      const saved = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code,
          name: { es: code },
          type,
          category,
          nature,
          systemRole,
          isPostable: true,
          isActive: true,
        }),
      );
      account[key] = saved.id;
    };

    await make('inventory', '1140', AccountType.ASSET, AccountCategory.CURRENT_ASSET, AccountNature.DEBIT, AccountRole.INVENTORY);
    await make('opening', '3150', AccountType.EQUITY, AccountCategory.OWNERS_EQUITY, AccountNature.CREDIT, AccountRole.OPENING_BALANCE_EQUITY);
    await make('adjustment', '5150', AccountType.EXPENSE, AccountCategory.OPERATING_EXPENSE, AccountNature.DEBIT, AccountRole.INVENTORY_ADJUSTMENT);

    await dataSource.getRepository(OrganizationSettings).save(
      dataSource.getRepository(OrganizationSettings).create({
        organizationId,
        baseCurrency: 'DOP',
        defaultInventoryId: account['inventory'],
        defaultOpeningBalanceEquityAccountId: account['opening'],
        defaultInventoryAdjustmentAccountId: account['adjustment'],
      }),
    );

    const year = new Date().getFullYear();
    await dataSource.getRepository(AccountingPeriod).save([
      {
        organizationId,
        name: `Ejercicio ${year}`,
        startDate: `${year}-01-01` as unknown as Date,
        endDate: `${year}-12-31` as unknown as Date,
        status: PeriodStatus.OPEN,
      },
    ]);
  });

  const signedBalance = async (key: string) =>
    (await balances.balancesAsOf({
      organizationId,
      ledgerId,
      asOf: `${new Date().getFullYear()}-12-31`,
    })).get(account[key]) ?? 0;

  const newProduct = (over: Partial<Product> = {}) => ({
    name: `Producto ${Math.random().toString(36).slice(2, 8)}`,
    price: 1_000,
    cost: 400,
    stock: 50,
    ...over,
  });

  it('puts the stock a product is created holding onto the balance sheet', async () => {
    await inventory.create(newProduct() as never, organizationId, ACTOR);

    // 50 × 400. Against opening balance equity, never retained earnings: goods carried in from a
    // previous system are not a result this company earned.
    expect(await signedBalance('inventory')).toBe(20_000);
    expect(await signedBalance('opening')).toBe(-20_000);
  });

  it('records the opening entry as an opening balance, not as a transaction of the period', async () => {
    await inventory.create(newProduct() as never, organizationId, ACTOR);

    const entry = await dataSource
      .getRepository(JournalEntry)
      .findOneByOrFail({ organizationId });
    expect(entry.entryType).toBe('OPENING_BALANCE');
  });

  it('posts nothing for a service, or for stock with no cost', async () => {
    await inventory.create(
      newProduct({ kind: ProductKind.SERVICE }) as never,
      organizationId,
      ACTOR,
    );
    await inventory.create(newProduct({ cost: 0 }) as never, organizationId, ACTOR);

    expect(await signedBalance('inventory')).toBe(0);
  });

  it('recognises a shortfall found by a stock count', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    await inventory.update(product.id, { stock: 48 } as never, organizationId, ACTOR);

    // Two units at 400 gone. Against the adjustment account, never cost of goods sold: a shrinkage
    // is not a cost of what was sold.
    expect(await signedBalance('inventory')).toBe(19_200);
    expect(await signedBalance('adjustment')).toBe(800);
  });

  it('recognises a change in unit cost as a revaluation of everything held', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    await inventory.update(product.id, { cost: 420 } as never, organizationId, ACTOR);

    expect(await signedBalance('inventory')).toBe(21_000);
    expect(await signedBalance('adjustment')).toBe(-1_000);
  });

  it('writes off what a deleted product was still holding', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    await inventory.remove(product.id, organizationId, ACTOR);

    // Removing the row alone left the value sitting in the inventory account with nothing in the
    // catalogue to account for it.
    expect(await signedBalance('inventory')).toBe(0);
    expect(await signedBalance('adjustment')).toBe(20_000);
  });

  it('posts the opening entry exactly once, however often the same creation is retried', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    await dataSource.transaction((manager) =>
      new InventoryPostingService(
        new JournalEntriesService(
          dataSource.getRepository(JournalEntry),
          dataSource.getRepository(JournalEntryAttachment),
          dataSource,
          {} as never,
          { startApprovalProcess: jest.fn().mockResolvedValue(null) } as never,
          new EventEmitter2(),
          { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
          new JournalEntryNumberingService(),
          new AuditTrailService(dataSource.getRepository(AuditLog)),
          new ExchangeRateResolver(dataSource),
        ),
      ).postOpeningStock(manager, product, ACTOR),
    );

    expect(await signedBalance('inventory')).toBe(20_000);
  });
});
