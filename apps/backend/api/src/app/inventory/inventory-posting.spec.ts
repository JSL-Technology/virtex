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
      // No photos are attached in these scenarios; the claim is a no-op.
      { claimImages: jest.fn().mockResolvedValue(null) } as never,
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
        { claimImages: jest.fn().mockResolvedValue(null) } as never,
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

  describe('an adjustment the books can trust', () => {
    /** Today in the tenant's calendar (Santo Domingo), which is what the posting checks against. */
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
    const draftOf = async (lines: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) =>
      adjustments.create(
        { date: today(), warehouseId: (await defaultWarehouse()).id, reason: 'Conteo', lines, ...over } as never,
        organizationId,
        ACTOR,
      );
    const fiscalYears = () =>
      dataSource.query(`SELECT COUNT(*)::int AS n FROM "fiscal_years" WHERE "organization_id" = $1`, [organizationId]).then((r) => r[0].n);

    it('refuses a date in the future or outside every period, without opening a fiscal year for it', async () => {
      const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
      const before = await fiscalYears();
      const nextYear = `${Number(today().slice(0, 4)) + 1}-03-01`;
      await expect(draftOf([{ productId: product.id, quantityChange: -1 }], { date: nextYear })).rejects.toMatchObject({
        messageKey: 'inventory.adjustment_date_in_future',
      });
      await expect(draftOf([{ productId: product.id, quantityChange: -1 }], { date: '2019-01-15' })).rejects.toMatchObject({
        messageKey: 'inventory.adjustment_date_without_period',
      });
      expect(await fiscalYears()).toBe(before);
    });

    it('refuses to post a count whose balance moved since it was taken, until someone decides', async () => {
      const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
      // Counted 48 while the screen said 50: two missing.
      const count = await draftOf([{ productId: product.id, countedQuantity: 48, expectedQuantity: 50 }]);
      // Meanwhile somebody books a loss of 10.
      const other = await draftOf([{ productId: product.id, quantityChange: -10 }]);
      await adjustments.post(other.id, organizationId, ACTOR);

      await expect(adjustments.post(count.id, organizationId, ACTOR)).rejects.toMatchObject({
        messageKey: 'inventory.adjustment_balance_changed',
        params: expect.objectContaining({ count: 1, lines: [expect.objectContaining({ expected: 50, current: 40, counted: 48 })] }),
      });
      // Nothing moved while refusing.
      expect(await ledger.balance(dataSource.manager, product.id, (await defaultWarehouse()).id)).toBe(40);

      // «Keep the difference»: the two found missing are what is booked.
      const posted = await adjustments.post(count.id, organizationId, ACTOR, 'keep_difference');
      expect(posted.lines[0]).toMatchObject({ quantityBefore: 40, quantityChange: -2 });
      expect(await ledger.balance(dataSource.manager, product.id, (await defaultWarehouse()).id)).toBe(38);
    });

    it('applies the count as the new balance when that is the decision', async () => {
      const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
      const count = await draftOf([{ productId: product.id, countedQuantity: 48, expectedQuantity: 50 }]);
      const other = await draftOf([{ productId: product.id, quantityChange: -10 }]);
      await adjustments.post(other.id, organizationId, ACTOR);
      const posted = await adjustments.post(count.id, organizationId, ACTOR, 'apply_count');
      expect(posted.lines[0]).toMatchObject({ quantityBefore: 40, quantityChange: 8 });
    });

    it('books shortfalls and revaluations on separate lines instead of netting them', async () => {
      const shrunk = await inventory.create(newProduct({ cost: 10, stock: 100 }) as never, organizationId, ACTOR);
      const revalued = await inventory.create(newProduct({ cost: 900, stock: 3 }) as never, organizationId, ACTOR);
      const draft = await draftOf([
        { productId: shrunk.id, quantityChange: -5 },
        { productId: revalued.id, newUnitCost: 950 },
      ]);
      const posted = await adjustments.post(draft.id, organizationId, ACTOR);
      expect(posted.valueChange).toBe(100);
      expect(posted.lines.map((line) => [line.quantityValue, line.revaluationValue])).toEqual([[-50, 0], [0, 150]]);

      const lines: Array<{ debit: string; credit: string; account_id: string }> = await dataSource.query(
        `SELECT l."debit", l."credit", l."account_id" FROM "journal_entry_lines" l WHERE l."journal_entry_id" = $1`,
        [posted.journalEntryId],
      );
      const onAdjustment = lines.filter((line) => line.account_id === account['adjustment']).map((line) => [Number(line.debit), Number(line.credit)]);
      // The loss and the revaluation each have their own line: 50 debited, 150 credited, not one 100 credit.
      expect(onAdjustment).toEqual(expect.arrayContaining([[50, 0], [0, 150]]));
      expect(onAdjustment).toHaveLength(2);
    });

    it('dates the kardex like the document and records a revaluation in it', async () => {
      const product = await inventory.create(newProduct({ cost: 900, stock: 3 }) as never, organizationId, ACTOR);
      const start = `${today().slice(0, 4)}-01-02`;
      const draft = await draftOf([{ productId: product.id, quantityChange: -1, newUnitCost: 950 }], { date: start });
      await adjustments.post(draft.id, organizationId, ACTOR);
      const rows: Array<{ type: string; date: Date; quantity: string; value: string }> = await dataSource.query(
        `SELECT "type", "date", "quantity", "value" FROM "stock_movements" WHERE "source_id" = $1 ORDER BY "type"`,
        [draft.id],
      );
      expect(rows.map((row) => row.type)).toEqual(['ADJUSTMENT', 'REVALUATION']);
      for (const row of rows) expect(new Date(row.date).toISOString().slice(0, 10)).toBe(start);
      expect(Number(rows[1].quantity)).toBe(0);
      expect(Number(rows[1].value)).toBe(100);
    });

    it('keeps the cent: a shortfall is valued so the ledger and the stock valuation agree', async () => {
      const product = await inventory.create(newProduct({ cost: 5.5, stock: 20.5 }) as never, organizationId, ACTOR);
      const draft = await draftOf([{ productId: product.id, quantityChange: -2.25 }]);
      const posted = await adjustments.post(draft.id, organizationId, ACTOR);
      // 20.5 × 5.50 = 112.75; 18.25 × 5.50 = 100.375 → 100.38. The loss is the difference: 12.37.
      expect(posted.lines[0].quantityValue).toBe(-12.37);
      expect(await signedBalance('inventory')).toBe(100.38);
    });

    it('keeps the lines in the order they were typed', async () => {
      const products = [];
      for (let i = 0; i < 5; i++) products.push(await inventory.create(newProduct() as never, organizationId, ACTOR));
      const draft = await draftOf(products.map((product) => ({ productId: product.id, quantityChange: -1 })));
      expect(draft.lines.map((line) => line.productId)).toEqual(products.map((product) => product.id));
    });

    it('reverses a posted adjustment with its mirror, once, and links the two', async () => {
      const product = await inventory.create(newProduct({ cost: 10, stock: 100 }) as never, organizationId, ACTOR);
      const draft = await draftOf([{ productId: product.id, countedQuantity: 95, expectedQuantity: 100 }]);
      const posted = await adjustments.post(draft.id, organizationId, ACTOR);
      expect(await signedBalance('adjustment')).toBe(50);

      const reversal = await adjustments.reverse(posted.id, organizationId, ACTOR, { reason: 'Se contó mal' });
      expect(reversal.status).toBe('POSTED');
      expect(reversal.reversesNumber).toBe(posted.number);
      expect(reversal.lines[0]).toMatchObject({ quantityChange: 5, quantityValue: 50 });
      expect(await ledger.balance(dataSource.manager, product.id, (await defaultWarehouse()).id)).toBe(100);
      expect(await signedBalance('adjustment')).toBe(0);
      expect((await adjustments.findOne(posted.id, organizationId)).reversedByNumber).toBe(reversal.number);

      await expect(adjustments.reverse(posted.id, organizationId, ACTOR, { reason: 'Otra vez' })).rejects.toMatchObject({
        messageKey: 'inventory.adjustment_already_reversed',
      });
      await expect(adjustments.reverse(reversal.id, organizationId, ACTOR, { reason: 'Otra vez' })).rejects.toMatchObject({
        messageKey: 'inventory.adjustment_reversal_not_reversible',
      });
    });

    it('records who cancelled a draft', async () => {
      const product = await inventory.create(newProduct() as never, organizationId, ACTOR);
      const draft = await draftOf([{ productId: product.id, quantityChange: -1 }]);
      const cancelled = await adjustments.cancel(draft.id, organizationId, ACTOR);
      expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelledByUserId: ACTOR });
      expect(cancelled.cancelledAt).toBeTruthy();
    });
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

  /**
   * A receipt undone (audit H-03): the goods go back out at the cost they came in at, the average
   * gives that value back, and Dr GRNI / Cr Inventory books it — or the void is refused because the
   * warehouse no longer holds what was received.
   */
  describe('a goods receipt undone', () => {
    beforeEach(async () => {
      await dataSource.getRepository(Journal).save({ organizationId, code: 'COMPRAS', name: 'Compras', type: 'PURCHASES' as const });
      const grni = await dataSource.getRepository(Account).save(
        dataSource.getRepository(Account).create({
          organizationId,
          code: '2150',
          name: { es: '2150' },
          type: AccountType.LIABILITY,
          category: AccountCategory.CURRENT_LIABILITY,
          nature: AccountNature.CREDIT,
          systemRole: AccountRole.GOODS_RECEIVED_NOT_INVOICED,
          isPostable: true,
          isActive: true,
        }),
      );
      account['grni'] = grni.id;
      await dataSource
        .getRepository(OrganizationSettings)
        .update({ organizationId }, { defaultGoodsReceivedNotInvoicedAccountId: grni.id });
    });

    const today = () => new Date().toISOString().slice(0, 10);
    const receive = (productId: string, quantity: number, unitCost: number, sourceId: string) =>
      dataSource.transaction((manager) =>
        inventory.receiveGoods(
          manager,
          organizationId,
          {
            reference: 'GR-TEST',
            sourceType: 'purchase_order_receipt',
            sourceId,
            date: today(),
            lines: [{ productId, quantity, unitCost, description: 'x' }],
          },
          ACTOR,
        ),
      );
    const giveBack = (productId: string, quantity: number, unitCost: number, sourceId: string, warehouseId: string | null) =>
      dataSource.transaction((manager) =>
        inventory.returnGoods(
          manager,
          organizationId,
          {
            reference: 'GR-TEST',
            sourceType: 'purchase_order_receipt',
            sourceId,
            date: today(),
            reason: 'Recibido por error',
            warehouseId,
            posted: true,
            lines: [{ productId, quantity, unitCost }],
          },
          ACTOR,
        ),
      );

    it('takes the goods back out at their receipt cost and books Dr GRNI / Cr Inventory', async () => {
      const product = await inventory.create(newProduct({ stock: 0, cost: 0 }) as never, organizationId, ACTOR);
      const sourceId = '55555555-5555-4555-8555-555555555555';
      const received = await receive(product.id, 10, 50, sourceId);
      expect(await signedBalance('inventory')).toBe(500);
      expect(await signedBalance('grni')).toBe(-500);

      const entryId = await giveBack(product.id, 4, 50, sourceId, received.warehouseId);

      expect(entryId).toEqual(expect.any(String));
      expect(await signedBalance('inventory')).toBe(300);
      expect(await signedBalance('grni')).toBe(-300);
      const after = await dataSource.getRepository(Product).findOneByOrFail({ id: product.id });
      expect(Number(after.stock)).toBe(6);
      expect(Number(after.cost)).toBe(50);
    });

    it('gives the receipt its value back out of the average cost', async () => {
      const product = await inventory.create(newProduct({ stock: 10, cost: 40 }) as never, organizationId, ACTOR);
      const sourceId = '66666666-6666-4666-8666-666666666666';
      const received = await receive(product.id, 10, 60, sourceId);
      expect(Number((await dataSource.getRepository(Product).findOneByOrFail({ id: product.id })).cost)).toBe(50);

      await giveBack(product.id, 10, 60, sourceId, received.warehouseId);

      const after = await dataSource.getRepository(Product).findOneByOrFail({ id: product.id });
      expect(Number(after.stock)).toBe(10);
      expect(Number(after.cost)).toBe(40);
      // Opening 400 + receipt 600 − return 600: what is held, at what it cost.
      expect(await signedBalance('inventory')).toBe(400);
    });

    it('refuses to un-receive goods that have already left the warehouse', async () => {
      const product = await inventory.create(newProduct({ stock: 0, cost: 0 }) as never, organizationId, ACTOR);
      const sourceId = '77777777-7777-4777-8777-777777777777';
      const received = await receive(product.id, 5, 20, sourceId);
      await dataSource.transaction((manager) =>
        inventory.decreaseStock(product.id, 5, manager, organizationId, {
          reference: 'F-1',
          sourceType: 'invoice',
          sourceId: '88888888-8888-4888-8888-888888888888',
          place: { warehouseId: received.warehouseId },
        }),
      );

      await expect(giveBack(product.id, 5, 20, sourceId, received.warehouseId)).rejects.toMatchObject({
        messageKey: 'inventory.not_enough_stock_in_warehouse',
      });
      // Nothing moved: the refusal rolled the whole void back.
      expect(Number((await dataSource.getRepository(Product).findOneByOrFail({ id: product.id })).stock)).toBe(0);
      expect(await signedBalance('grni')).toBe(-100);
    });
  });
});
