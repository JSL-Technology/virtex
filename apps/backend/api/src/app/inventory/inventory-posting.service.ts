import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Product, ProductKind } from './entities/product.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { JournalEntryType } from '../journal-entries/entities/journal-entry.entity';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';
import { BadRequestError } from '../i18n/localized.exception';
import { roundAmount, toCents } from '../common/money';

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

  constructor(private readonly journalEntries: JournalEntriesService) {}

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
      throw new BadRequestError('INVENTORY.CUENTAS_INVENTARIO_NO_CONFIGURADAS');
    }

    return this.post(
      manager,
      product.organizationId,
      {
        date: new Date().toISOString(),
        description: `Inventario inicial: ${product.name}`,
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
            description: `Existencia inicial de ${product.name}`,
          },
          {
            accountId: openingId,
            debit: 0,
            credit: value,
            description: 'Contrapartida de saldos iniciales',
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
      throw new BadRequestError('INVENTORY.CUENTAS_AJUSTE_NO_CONFIGURADAS');
    }

    const amount = Math.abs(delta);
    const increase = delta > 0;
    return this.post(
      manager,
      product.organizationId,
      {
        date: new Date().toISOString(),
        description: `Ajuste de inventario: ${product.name}`,
        journalId: journal.id,
        currencyCode: settings.baseCurrency ?? 'USD',
        exchangeRate: 1,
        lines: [
          {
            accountId: inventoryId,
            debit: increase ? amount : 0,
            credit: increase ? 0 : amount,
            description: `${increase ? 'Entrada' : 'Salida'} por ajuste — ${product.name}`,
          },
          {
            accountId: adjustmentId,
            debit: increase ? 0 : amount,
            credit: increase ? amount : 0,
            description: increase
              ? 'Sobrante en ajuste de inventario'
              : 'Faltante en ajuste de inventario',
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async post(
    manager: EntityManager,
    organizationId: string,
    dto: CreateJournalEntryDto,
    context: { actorUserId: string | null; systemReason: string; idempotencyKey?: string },
  ): Promise<string> {
    const entry = await this.journalEntries.createWithManager(manager, dto, organizationId, {
      ...context,
      module: ModuleSlug.INVENTORY,
    });
    this.logger.log(`${dto.description} contabilizado en ${entry.entryNumber ?? entry.id}.`);
    return entry.id;
  }

  private async context(
    manager: EntityManager,
    organizationId: string,
  ): Promise<{ settings: OrganizationSettings; journal: Journal }> {
    const settings = await manager.findOneBy(OrganizationSettings, { organizationId });
    if (!settings) {
      throw new BadRequestError('INVENTORY.CUENTAS_INVENTARIO_NO_CONFIGURADAS');
    }
    const journal = await manager.findOneBy(Journal, { organizationId, code: 'GENERAL' });
    if (!journal) {
      throw new BadRequestError('INVENTORY.DIARIO_GENERAL_NO_ENCONTRADO');
    }
    return { settings, journal };
  }
}
