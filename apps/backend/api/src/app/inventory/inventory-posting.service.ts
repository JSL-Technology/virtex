import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Product, ProductKind } from './entities/product.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { AccountingPostingPort } from '../journal-entries/accounting-posting.port';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { JournalEntryType } from '../journal-entries/entities/journal-entry.entity';
import { ModuleSlug } from '../journal-entries/accounting-posting.port';
import { BadRequestError } from '../i18n/localized.exception';
import { roundAmount, toCents } from '../common/money';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';

/** What an item was worth on the books at a point in time. */
interface Valuation {
  readonly quantity: number;
  readonly unitCost: number;
}

const valueOf = (v: Valuation): number => roundAmount(v.quantity * v.unitCost);

/**
 * The ledger side of the product catalogue.
 *
 * ## What was missing
 *
 * Stock could be created and changed from the product form with **no entry in the books at all**.
 * A product saved with 50 units at 400 each put 20,000 of real asset into the warehouse and nothing
 * onto the balance sheet; the first invoice that sold one of them then credited the inventory
 * account for its cost, so `Inventarios` went *negative* — an asset reported below zero — and the
 * balance sheet a tenant showed their bank was wrong by the whole value of what they held.
 *
 * ## The two movements
 *
 * **Opening stock** — what the company already had when the books were opened. It debits inventory
 * and credits *opening balance equity*, never retained earnings and never an income account: goods
 * carried in from a previous system are not a result this company earned in this period.
 *
 * **An adjustment** — every later change made by hand: a stock count that disagrees with the
 * record, breakage, theft, a corrected unit cost. It moves inventory against
 * `AccountRole.INVENTORY_ADJUSTMENT`, so the difference between the warehouse and the balance sheet
 * is always explained by a line somebody can read. Cost of goods sold is deliberately not used for
 * it: a shrinkage is not a cost of what was sold.
 *
 * Purchases and sales are *not* handled here. A vendor bill already debits inventory and an invoice
 * already relieves it; posting again from the catalogue would double-count both.
 */
@Injectable()
export class InventoryPostingService {
  private readonly logger = new Logger(InventoryPostingService.name);

  constructor(
    private readonly posting: AccountingPostingPort,
    /** The ledger's narrative, in the language the books are kept in. */
    private readonly narrative: LedgerNarrativeService,
    private readonly orgSettings: OrgSettingsService,
    private readonly journalLookup: JournalLookupService,
  ) {}

  /**
   * Recognise the stock a product is created holding.
   *
   * Returns the entry id, or null when there is nothing to recognise — a service, no quantity, or
   * no unit cost, in which case the value really is zero and an entry would say nothing.
   */
  async postOpeningStock(
    manager: EntityManager,
    product: Product,
    actorUserId: string | null,
  ): Promise<string | null> {
    const value = valueOf({ quantity: product.stock, unitCost: product.cost });
    if (product.kind === ProductKind.SERVICE || toCents(value) <= 0) return null;

    const { settings, journal } = await this.context(manager, product.organizationId);
    const inventoryId = settings.defaultInventoryId;
    const openingId = settings.defaultOpeningBalanceEquityAccountId;
    if (!inventoryId || !openingId) {
      throw new BadRequestError('inventory.organization_has_no_inventory_opening_balance');
    }

    //  El relato en el idioma en que se llevan los libros del inquilino, no en castellano fijo.
    const words = await this.words(manager, product.organizationId, {
      entry: { key: 'ledger.inventory.opening_entry', params: { product: product.name } },
      stock: { key: 'ledger.inventory.opening_stock', params: { product: product.name } },
      counterpart: { key: 'ledger.inventory.opening_counterpart' },
    });

    return this.post(
      manager,
      product.organizationId,
      {
        date: new Date().toISOString(),
        description: words.entry,
        journalId: journal.id,
        currencyCode: settings.baseCurrency ?? 'USD',
        exchangeRate: 1,
        // An opening balance, not a transaction of the period — the closing process and every
        // comparative report depend on being able to tell the two apart.
        entryType: JournalEntryType.OPENING_BALANCE,
        lines: [
          {
            accountId: inventoryId,
            debit: value,
            credit: 0,
            description: words.stock,
          },
          {
            accountId: openingId,
            debit: 0,
            credit: value,
            description: words.counterpart,
          },
        ],
      },
      {
        actorUserId,
        systemReason: 'inventory-opening-stock',
        idempotencyKey: `product:${product.id}:opening-stock`,
      },
    );
  }

  /**
   * Recognise a hand-made change to what is held: a different quantity, a different unit cost, or
   * both. The movement is the difference in *value*, which is the only figure the ledger carries.
   */
  async postValuationChange(
    manager: EntityManager,
    product: Product,
    before: Valuation,
    actorUserId: string | null,
    /** Why, when a person made the change. Appended to the entry's narrative. */
    reason?: string,
  ): Promise<string | null> {
    if (product.kind === ProductKind.SERVICE) return null;

    const delta = roundAmount(
      valueOf({ quantity: product.stock, unitCost: product.cost }) - valueOf(before),
    );
    if (toCents(delta) === 0) return null;

    const { settings, journal } = await this.context(manager, product.organizationId);
    const inventoryId = settings.defaultInventoryId;
    const adjustmentId = settings.defaultInventoryAdjustmentAccountId;
    if (!inventoryId || !adjustmentId) {
      throw new BadRequestError('inventory.organization_has_no_inventory_inventory_adjustment');
    }

    const amount = Math.abs(delta);
    const increase = delta > 0;
    const words = await this.words(manager, product.organizationId, {
      entry: { key: 'ledger.inventory.adjustment_entry', params: { product: product.name } },
      movement: {
        key: increase ? 'ledger.inventory.adjustment_in' : 'ledger.inventory.adjustment_out',
        params: { product: product.name },
      },
      counterpart: {
        key: increase ? 'ledger.inventory.adjustment_surplus' : 'ledger.inventory.adjustment_shortfall',
      },
    });
    return this.post(
      manager,
      product.organizationId,
      {
        date: new Date().toISOString(),
        description: reason ? `${words.entry} — ${reason}` : words.entry,
        journalId: journal.id,
        currencyCode: settings.baseCurrency ?? 'USD',
        exchangeRate: 1,
        lines: [
          {
            accountId: inventoryId,
            debit: increase ? amount : 0,
            credit: increase ? 0 : amount,
            description: words.movement,
          },
          {
            accountId: adjustmentId,
            debit: increase ? 0 : amount,
            credit: increase ? amount : 0,
            description: words.counterpart,
          },
        ],
      },
      {
        actorUserId,
        systemReason: 'inventory-adjustment',
        // Deliberately no idempotency key: two identical corrections on the same product are two
        // real movements, unlike an opening balance, which exists exactly once per product.
      },
    );
  }

  /**
   * Goods received against a purchase order: Dr Inventory / Cr Goods received not invoiced.
   *
   * The supplier's invoice later debits GRNI and credits payables for the same goods, so the
   * purchase is booked once and the bridge account holds, at any moment, what arrived and has not
   * been billed yet (QA C-07). Posted in the purchases journal; idempotent per receipt.
   */
  async postGoodsReceipt(
    manager: EntityManager,
    organizationId: string,
    receipt: {
      reference: string;
      sourceId: string;
      date: string;
      lines: ReadonlyArray<{ description: string; amount: number }>;
    },
    actorUserId: string | null,
  ): Promise<string | null> {
    const lines = receipt.lines.filter((line) => toCents(line.amount) > 0);
    if (lines.length === 0) return null;

    // The purchases journal: a receipt is the first half of a purchase.
    const { settings, journal } = await this.context(manager, organizationId, 'COMPRAS');
    const inventoryId = settings.defaultInventoryId;
    const grniId = settings.defaultGoodsReceivedNotInvoicedAccountId;
    if (!inventoryId || !grniId) {
      throw new BadRequestError('inventory.goods_receipt_accounts_not_configured');
    }

    const total = roundAmount(lines.reduce((sum, line) => sum + line.amount, 0));
    const words = await this.words(manager, organizationId, {
      entry: { key: 'ledger.inventory.goods_receipt_entry', params: { reference: receipt.reference } },
      counterpart: { key: 'ledger.inventory.goods_receipt_counterpart', params: { reference: receipt.reference } },
    });

    return this.post(
      manager,
      organizationId,
      {
        date: receipt.date,
        description: words.entry,
        journalId: journal.id,
        currencyCode: settings.baseCurrency ?? undefined,
        exchangeRate: 1,
        lines: [
          ...lines.map((line) => ({
            accountId: inventoryId,
            debit: roundAmount(line.amount),
            credit: 0,
            description: line.description,
          })),
          { accountId: grniId, debit: 0, credit: total, description: words.counterpart },
        ],
      },
      {
        actorUserId,
        systemReason: 'goods-receipt',
        idempotencyKey: `po-receipt:${receipt.sourceId}`,
      },
    );
  }

  /**
   * An inventory adjustment document: one entry for all its lines, inventory against
   * `AccountRole.INVENTORY_ADJUSTMENT`, a line per product so the entry reads like the document.
   *
   * Each line's amount is signed — positive a surplus or an upward revaluation, negative a loss.
   * Idempotent per adjustment: posting the same document twice cannot book it twice.
   */
  async postAdjustment(
    manager: EntityManager,
    organizationId: string,
    adjustment: {
      id: string;
      number: string;
      date: string;
      reason: string;
      lines: ReadonlyArray<{ description: string; amount: number }>;
    },
    actorUserId: string | null,
  ): Promise<string | null> {
    const lines = adjustment.lines.filter((line) => toCents(line.amount) !== 0);
    if (lines.length === 0) return null;

    const { settings, journal } = await this.context(manager, organizationId);
    const inventoryId = settings.defaultInventoryId;
    const adjustmentId = settings.defaultInventoryAdjustmentAccountId;
    if (!inventoryId || !adjustmentId) {
      throw new BadRequestError('inventory.organization_has_no_inventory_inventory_adjustment');
    }

    const net = roundAmount(lines.reduce((sum, line) => sum + line.amount, 0));
    const words = await this.words(manager, organizationId, {
      entry: { key: 'ledger.inventory.adjustment_document_entry', params: { number: adjustment.number } },
      surplus: { key: 'ledger.inventory.adjustment_surplus' },
      shortfall: { key: 'ledger.inventory.adjustment_shortfall' },
    });

    return this.post(
      manager,
      organizationId,
      {
        date: adjustment.date,
        description: `${words.entry} — ${adjustment.reason}`,
        journalId: journal.id,
        currencyCode: settings.baseCurrency ?? 'USD',
        exchangeRate: 1,
        lines: [
          ...lines.map((line) => ({
            accountId: inventoryId,
            debit: line.amount > 0 ? roundAmount(line.amount) : 0,
            credit: line.amount < 0 ? roundAmount(-line.amount) : 0,
            description: line.description,
          })),
          ...(toCents(net) === 0
            ? []
            : [
                {
                  accountId: adjustmentId,
                  debit: net < 0 ? roundAmount(-net) : 0,
                  credit: net > 0 ? roundAmount(net) : 0,
                  description: net > 0 ? words.surplus : words.shortfall,
                },
              ]),
        ],
      },
      {
        actorUserId,
        systemReason: 'inventory-adjustment',
        idempotencyKey: `inventory-adjustment:${adjustment.id}`,
      },
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async post(
    manager: EntityManager,
    organizationId: string,
    dto: CreateJournalEntryDto,
    context: { actorUserId: string | null; systemReason: string; idempotencyKey?: string },
  ): Promise<string> {
    const entry = await this.posting.createWithManager(manager, dto, organizationId, {
      ...context,
      module: ModuleSlug.INVENTORY,
    });
    this.logger.log(`${dto.description} contabilizado en ${entry.entryNumber ?? entry.id}.`);
    return entry.id;
  }

  private async context(
    manager: EntityManager,
    organizationId: string,
    journalCode = 'GENERAL',
  ): Promise<{ settings: OrganizationSettings; journal: Journal }> {
    const settings = await this.orgSettings.requireForOrg(organizationId, manager);
    const journal = await this.journalLookup.requireByCode(organizationId, journalCode, manager);
    return { settings, journal };
  }

  /** The entry's narrative, in the language the tenant's books are kept in. */
  private words<K extends string>(
    manager: EntityManager,
    organizationId: string,
    keys: Record<K, { key: string; params?: Record<string, unknown> }>,
  ): Promise<Record<K, string>> {
    return this.narrative.describeAll(manager, organizationId, keys);
  }
}
