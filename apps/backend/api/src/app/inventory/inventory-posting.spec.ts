import { DataSource } from 'typeorm';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
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
import { testExchangeRateResolver } from '../currencies/exchange-rate-resolver.testing';
import { Product, ProductKind } from './entities/product.entity';
import { InventoryService } from './inventory.service';
import { StockLedgerService } from './stock-ledger.service';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';
import { InventoryPostingService } from './inventory-posting.service';
import { ProductCategoriesService } from './product-categories.service';
import { ProductCategory } from './entities/product-category.entity';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';

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
  let inventory: InventoryService;
  let adjustments: InventoryAdjustmentsService;
  const ledger = new StockLedgerService();
  let dataSource: DataSource;
  let entries: JournalEntriesService;
  /** The real narrative service: the entries assert the sentences the ledger will carry. */
  const narrative = new LedgerNarrativeService(new I18nService());
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
    entries = new JournalEntriesService(
      dataSource.getRepository(JournalEntry),
      dataSource.getRepository(JournalEntryAttachment),
      dataSource,
      {} as never,
      { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
      new EventEmitter2(),
      { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
      new JournalEntryNumberingService(),
      new AuditTrailService(dataSource.getRepository(AuditLog)),
      testExchangeRateResolver(dataSource),
    );

    inventory = new InventoryService(
      dataSource.getRepository(Product),
      dataSource,
      new InventoryPostingService(
        entries,
        narrative,
        new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
        new JournalLookupService(dataSource.getRepository(Journal)),
      ),
      // The real category service: a product's category must belong to this tenant and still be
      // offered, and that check is part of what creating a product means now.
      new ProductCategoriesService(
        dataSource.getRepository(ProductCategory),
        dataSource.getRepository(Product),
      ),
      ledger,
    );
    // Stock counts and revaluations are documents now, not edits of the product.
    adjustments = new InventoryAdjustmentsService(
      dataSource,
      ledger,
      new InventoryPostingService(
        entries,
        narrative,
        new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
        new JournalLookupService(dataSource.getRepository(Journal)),
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

  /**
   * The ledger narrates itself in the language the books are kept in.
   *
   * Every system-generated description was a Spanish template literal — `Inventario inicial: …`,
   * `Ajuste de inventario: …`, `Recibo de cobro …` — so a tenant in the United States, invoicing
   * in English and reading an English interface, opened its own general ledger and found its
   * accounting narrated in a language nobody at the company reads.
   *
   * The language is the ORGANISATION's, not the reader's: a narrative is part of the record, and
   * an auditor reading the books in six years expects what was written then.
   */
  describe('the narrative on a system-generated entry', () => {
    /**
     * A posting service whose narrative cache is empty.
     *
     * `LedgerNarrativeService` caches the books language per organisation for the life of the
     * process — it is fixed at provisioning and changing it would make one book read in two
     * languages — so a test that changes it has to use an instance that has not looked it up.
     */
    const postingIn = () =>
      new InventoryService(
        dataSource.getRepository(Product),
        dataSource,
        new InventoryPostingService(
          entries,
          new LedgerNarrativeService(new I18nService()),
          new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
          new JournalLookupService(dataSource.getRepository(Journal)),
        ),
        new ProductCategoriesService(
          dataSource.getRepository(ProductCategory),
          dataSource.getRepository(Product),
        ),
        ledger,
      );

    /** The most recent entry's narrative — the one the test just caused. */
    const lastNarrative = async () =>
      (
        await dataSource
          .getRepository(JournalEntry)
          .findOneOrFail({ where: { organizationId }, order: { createdAt: 'DESC' } })
      ).description;

    it('is written in the language the books are kept in', async () => {
      await dataSource
        .getRepository(Organization)
        .update({ id: organizationId }, { booksLanguage: 'en' });

      await postingIn().create(newProduct({ name: 'Hex bolt M6' }) as never, organizationId, ACTOR);

      expect(await lastNarrative()).toBe('Opening stock: Hex bolt M6');
    });

    it("uses the product's default language when the tenant has stated none", async () => {
      // Null is what the tenants that produced the entries already in the books had, and Spanish
      // is what those entries say — which is why nothing is rewritten.
      await dataSource
        .getRepository(Organization)
        .update({ id: organizationId }, { booksLanguage: null });

      await postingIn().create(newProduct({ name: 'Tornillo M6' }) as never, organizationId, ACTOR);

      expect(await lastNarrative()).toBe('Inventario inicial: Tornillo M6');
    });
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

  /** The warehouse a product created with stock put it in: the company's default. */
  const defaultWarehouse = () => dataSource.manager.transaction((manager) => ledger.defaultWarehouse(manager, organizationId));

  it('recognises a shortfall found by a stock count, as a posted adjustment', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    const warehouse = await defaultWarehouse();
    const draft = await adjustments.create(
      {
        date: new Date().toISOString().slice(0, 10),
        warehouseId: warehouse.id,
        reason: 'Conteo físico de fin de mes',
        lines: [{ productId: product.id, countedQuantity: 48 }],
      },
      organizationId,
      ACTOR,
    );
    expect(draft.lines[0].onHand).toBe(50);
    const posted = await adjustments.post(draft.id, organizationId, ACTOR);

    // Two units at 400 gone. Against the adjustment account, never cost of goods sold: a shrinkage
    // is not a cost of what was sold.
    expect(posted.status).toBe('POSTED');
    expect(posted.lines[0]).toMatchObject({ quantityBefore: 50, quantityChange: -2, valueChange: -800 });
    expect(await signedBalance('inventory')).toBe(19_200);
    expect(await signedBalance('adjustment')).toBe(800);
    expect(await ledger.balance(dataSource.manager, product.id, warehouse.id)).toBe(48);
    expect(Number((await dataSource.getRepository(Product).findOneByOrFail({ id: product.id })).stock)).toBe(48);
  });

  it('refuses to change stock or the cost of held stock from the product', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);

    // What is held changes through documents with a warehouse, a reason and an entry.
    await expect(
      inventory.update(product.id, { stock: 48 } as never, organizationId, ACTOR),
    ).rejects.toMatchObject({ messageKey: 'inventory.stock_changes_through_adjustments' });
    await expect(
      inventory.update(product.id, { cost: 420 } as never, organizationId, ACTOR),
    ).rejects.toMatchObject({ messageKey: 'inventory.cost_changes_through_adjustments' });
    expect(await signedBalance('adjustment')).toBe(0);
  });

  it('recognises a new unit cost as a revaluation of everything held', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    const warehouse = await defaultWarehouse();
    const draft = await adjustments.create(
      {
        date: new Date().toISOString().slice(0, 10),
        warehouseId: warehouse.id,
        reason: 'Nuevo costo del proveedor',
        lines: [{ productId: product.id, newUnitCost: 420 }],
      },
      organizationId,
      ACTOR,
    );
    await adjustments.post(draft.id, organizationId, ACTOR);

    expect(await signedBalance('inventory')).toBe(21_000);
    expect(await signedBalance('adjustment')).toBe(-1_000);
  });

  it('keeps a product with stock history: it is deactivated, not deleted', async () => {
    const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
    await expect(inventory.remove(product.id, organizationId, ACTOR)).rejects.toMatchObject({
      messageKey: 'inventory.product_delete_blocked',
    });
    expect(await signedBalance('inventory')).toBe(20_000);
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
          { startApprovalProcess: jest.fn().mockResolvedValue(null), announcePending: jest.fn() } as never,
          new EventEmitter2(),
          { enforceLimit: jest.fn().mockResolvedValue(undefined) } as never,
          new JournalEntryNumberingService(),
          new AuditTrailService(dataSource.getRepository(AuditLog)),
          testExchangeRateResolver(dataSource),
        ),
        narrative,
        new OrgSettingsService(dataSource.getRepository(OrganizationSettings)),
        new JournalLookupService(dataSource.getRepository(Journal)),
      ).postOpeningStock(manager, product, ACTOR),
    );

    expect(await signedBalance('inventory')).toBe(20_000);
  });
});
