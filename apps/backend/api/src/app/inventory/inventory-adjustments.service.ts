import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  InventoryAdjustment,
  InventoryAdjustmentLine,
  InventoryAdjustmentStatus,
} from './entities/inventory-adjustment.entity';
import { Product, ProductKind, ProductStatus } from './entities/product.entity';
import { Warehouse } from '../supply-chain/entities/warehouse.entity';
import { StockLedgerService } from './stock-ledger.service';
import { AdjustmentValueKind, InventoryPostingService } from './inventory-posting.service';
import {
  BalanceChangeDecision,
  InventoryAdjustmentQueryDto,
  ReverseInventoryAdjustmentDto,
  SaveInventoryAdjustmentDto,
} from './dto/inventory-adjustment.dto';
import { allocateDocumentNumber, DOCUMENT_SEQUENCE_SCOPE } from '../shared/numbering/document-numbers';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { roundAmount } from '../common/money';
import { toIsoDate } from '../common/dates';
import { postingPeriodCovering } from '../contracts/closing/posting-period.contract';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { inventoryAccountsConfigured } from '../organizations/contracts/default-accounts.contract';
import { userDisplayNames } from '../users/contracts/user-names.contract';

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const EPSILON = 1e-9;

/** Whether a document date can be posted to, and if not, why — for the draft, before posting. */
export interface AdjustmentDateReadiness {
  /** The period the date falls in, if the calendar has one. */
  period: { name: string; open: boolean } | null;
  /** A message key explaining why the date cannot be posted, or null when it can. */
  problem: string | null;
  params: Record<string, unknown>;
}

export interface InventoryAdjustmentLineView extends InventoryAdjustmentLine {
  productName: string;
  sku: string | null;
  unitOfMeasure: string | null;
  /** What the warehouse holds now (drafts only): the figure a count is compared with on posting. */
  onHand: number | null;
  /** The product's average unit cost now (drafts only): what a shortfall would leave at. */
  currentUnitCost: number | null;
}

export interface InventoryAdjustmentView extends Omit<InventoryAdjustment, 'lines'> {
  warehouseName: string | null;
  lines: InventoryAdjustmentLineView[];
  createdByName: string | null;
  postedByName: string | null;
  cancelledByName: string | null;
  reversesNumber: string | null;
  reversedByNumber: string | null;
  /**
   * What a draft still needs before it can be posted, told while it can still be fixed: the period
   * of its date and whether the accounts it posts to are configured. Null once posted or cancelled.
   */
  readiness: {
    date: AdjustmentDateReadiness;
    accountsConfigured: boolean;
  } | null;
}

/** One line whose warehouse balance moved between the count and the posting. */
interface BalanceConflict {
  productId: string;
  productName: string;
  sku: string | null;
  counted: number;
  expected: number;
  current: number;
}

/**
 * Inventory adjustments: drafted, reviewed, posted — and, when posted wrongly, reversed.
 *
 * Posting is where everything happens, in one transaction: each line's change is taken against the
 * warehouse balance read under the stock ledger's locks, the stock moves on the document's date,
 * a surplus re-averages the unit cost, a new unit cost revalues the product's whole stock (and
 * says so in the kardex), and one journal entry books the value moved against the inventory
 * adjustment account, by nature: shortfalls, surpluses and revaluations each on their own line.
 *
 * ## What posting refuses, and why
 *
 * - **A date the books cannot take**: in the future, outside any period the calendar already has,
 *   or in a period closed for the general ledger or for inventory. The journal posting would open
 *   a whole fiscal year for a mistyped `2019` — and did — so the document checks first, while it is
 *   a draft, and says which.
 * - **A count whose balance moved since it was taken**, unless the person decides what the count
 *   means now (see `BalanceChangeDecision`). Applying it silently undid the movement in between: a
 *   count of 88 against a screen showing 90 (−2) posted as +8 after another user booked −10.
 *
 * A posted adjustment is final. It is corrected by its reversal — a document of its own, with its
 * own number and entry, linked both ways — never by editing.
 */
@Injectable()
export class InventoryAdjustmentsService {
  private readonly logger = new Logger(InventoryAdjustmentsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: StockLedgerService,
    private readonly posting: InventoryPostingService,
  ) {}

  async findAll(organizationId: string, query: InventoryAdjustmentQueryDto = {}) {
    const qb = this.dataSource
      .getRepository(InventoryAdjustment)
      .createQueryBuilder('adjustment')
      .leftJoin('adjustment.warehouse', 'warehouse')
      .addSelect(['warehouse.id', 'warehouse.name'])
      .loadRelationCountAndMap('adjustment.lineCount', 'adjustment.lines')
      .where('adjustment.organizationId = :organizationId', { organizationId })
      .orderBy('adjustment.date', 'DESC')
      .addOrderBy('adjustment.number', 'DESC')
      .take(500);
    if (query.status) qb.andWhere('adjustment.status = :status', { status: query.status });
    if (query.warehouseId) qb.andWhere('adjustment.warehouseId = :warehouseId', { warehouseId: query.warehouseId });
    const rows = await qb.getMany();
    return rows.map(({ warehouse, ...row }) => ({ ...row, warehouseName: warehouse?.name ?? null }));
  }

  async findOne(id: string, organizationId: string, manager: EntityManager = this.dataSource.manager): Promise<InventoryAdjustmentView> {
    const adjustment = await manager.findOne(InventoryAdjustment, {
      where: { id, organizationId },
      relations: { lines: { product: true }, warehouse: true },
      order: { lines: { position: 'ASC', id: 'ASC' } },
    });
    if (!adjustment) throw new NotFoundError('inventory.adjustment_not_found');
    const draft = adjustment.status === InventoryAdjustmentStatus.DRAFT;
    const lines: InventoryAdjustmentLineView[] = [];
    for (const line of adjustment.lines) {
      const { product, ...rest } = line;
      lines.push({
        ...rest,
        productName: product?.name ?? '',
        sku: product?.sku ?? null,
        unitOfMeasure: product?.unitOfMeasure ?? null,
        onHand: draft ? await this.ledger.balance(manager, line.productId, adjustment.warehouseId, organizationId) : null,
        currentUnitCost: draft && product ? Number(product.cost) : null,
      });
    }

    const people = await this.namesOf(manager, [adjustment.createdByUserId, adjustment.postedByUserId, adjustment.cancelledByUserId]);
    const linked = await this.numbersOf(manager, organizationId, [adjustment.reversesAdjustmentId, adjustment.reversedByAdjustmentId]);

    const { warehouse, lines: _lines, ...rest } = adjustment;
    return {
      ...rest,
      warehouseName: warehouse?.name ?? null,
      lines,
      createdByName: people.get(adjustment.createdByUserId ?? '') ?? null,
      postedByName: people.get(adjustment.postedByUserId ?? '') ?? null,
      cancelledByName: people.get(adjustment.cancelledByUserId ?? '') ?? null,
      reversesNumber: linked.get(adjustment.reversesAdjustmentId ?? '') ?? null,
      reversedByNumber: linked.get(adjustment.reversedByAdjustmentId ?? '') ?? null,
      readiness: draft
        ? {
            date: await this.dateReadiness(manager, organizationId, adjustment.date),
            accountsConfigured: await this.accountsConfigured(manager, organizationId),
          }
        : null,
    };
  }

  /**
   * Whether a date can carry an adjustment, without posting anything — for the form to say so as
   * soon as the date is chosen rather than after the person has typed every line.
   */
  async checkDate(organizationId: string, date: string): Promise<AdjustmentDateReadiness> {
    return this.dateReadiness(this.dataSource.manager, organizationId, toIsoDate(date));
  }

  async create(dto: SaveInventoryAdjustmentDto, organizationId: string, actorUserId: string | null): Promise<InventoryAdjustmentView> {
    const id = await this.dataSource.transaction(async (manager) => {
      await this.validate(manager, organizationId, dto);
      const date = toIsoDate(dto.date);
      await this.assertPostableDate(manager, organizationId, date);
      const adjustment = await manager.save(
        manager.create(InventoryAdjustment, {
          organizationId,
          number: await this.allocateNumber(manager, organizationId, date),
          date,
          warehouseId: dto.warehouseId,
          reason: dto.reason.trim(),
          notes: dto.notes?.trim() || null,
          status: InventoryAdjustmentStatus.DRAFT,
          createdByUserId: actorUserId,
          lines: dto.lines.map((line, position) => this.lineFrom(line, position)),
        }),
      );
      return adjustment.id;
    });
    return this.findOne(id, organizationId);
  }

  async update(id: string, dto: SaveInventoryAdjustmentDto, organizationId: string): Promise<InventoryAdjustmentView> {
    await this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lockDraft(manager, id, organizationId);
      await this.validate(manager, organizationId, dto);
      const date = toIsoDate(dto.date);
      await this.assertPostableDate(manager, organizationId, date);
      await manager.delete(InventoryAdjustmentLine, { adjustmentId: adjustment.id });
      adjustment.date = date;
      adjustment.warehouseId = dto.warehouseId;
      adjustment.reason = dto.reason.trim();
      adjustment.notes = dto.notes?.trim() || null;
      adjustment.lines = dto.lines.map((line, position) =>
        manager.create(InventoryAdjustmentLine, { ...this.lineFrom(line, position), adjustmentId: adjustment.id }),
      );
      await manager.save(adjustment);
    });
    return this.findOne(id, organizationId);
  }

  async cancel(id: string, organizationId: string, actorUserId: string | null = null): Promise<InventoryAdjustmentView> {
    await this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lockDraft(manager, id, organizationId);
      adjustment.status = InventoryAdjustmentStatus.CANCELLED;
      adjustment.cancelledByUserId = actorUserId;
      adjustment.cancelledAt = new Date();
      await manager.save(adjustment);
    });
    return this.findOne(id, organizationId);
  }

  async post(
    id: string,
    organizationId: string,
    actorUserId: string | null,
    onBalanceChange?: BalanceChangeDecision,
  ): Promise<InventoryAdjustmentView> {
    await this.dataSource.transaction(async (manager) => {
      const adjustment = await this.lockDraft(manager, id, organizationId);
      await this.postLocked(manager, organizationId, adjustment, actorUserId, onBalanceChange);
    });
    return this.findOne(id, organizationId);
  }

  /**
   * Undo a posted adjustment with its mirror image.
   *
   * Each line moves back what the original moved — a shortfall re-enters at the cost it left at, a
   * surplus leaves at today's average — and a revaluation is taken back by the value it added,
   * spread over the stock held now. The reversal is posted at once (there is nothing to review: it
   * is fully determined by the original), and the two documents point at each other.
   */
  async reverse(
    id: string,
    organizationId: string,
    actorUserId: string | null,
    dto: ReverseInventoryAdjustmentDto,
  ): Promise<InventoryAdjustmentView> {
    const reversalId = await this.dataSource.transaction(async (manager) => {
      const original = await this.lockAdjustment(manager, id, organizationId);
      if (original.status !== InventoryAdjustmentStatus.POSTED) {
        throw new ConflictError('inventory.adjustment_reverse_not_posted', { number: original.number });
      }
      if (original.reversedByAdjustmentId) {
        throw new ConflictError('inventory.adjustment_already_reversed', { number: original.number });
      }
      if (original.reversesAdjustmentId) {
        throw new ConflictError('inventory.adjustment_reversal_not_reversible', { number: original.number });
      }

      const date = toIsoDate(dto.date ?? (await organizationToday(manager, organizationId)));
      if (date < String(original.date).slice(0, 10)) {
        throw new BadRequestError('inventory.adjustment_reversal_before_original', { number: original.number, date: original.date });
      }
      await this.assertPostableDate(manager, organizationId, date);

      const originalLines = await manager.find(InventoryAdjustmentLine, {
        where: { adjustmentId: original.id },
        order: { position: 'ASC', id: 'ASC' },
      });

      const lines: Array<Partial<InventoryAdjustmentLine>> = [];
      for (const [position, line] of originalLines.entries()) {
        const quantity = round6(-Number(line.quantityChange));
        let newUnitCost: number | null = null;
        const revaluation = Number(line.revaluationValue ?? 0);
        if (Math.abs(revaluation) >= 0.005) {
          const product = await manager.findOneOrFail(Product, { where: { id: line.productId, organizationId } });
          const held = Math.max(Number(product.stock), 0) + Math.max(quantity, 0);
          if (held <= EPSILON) {
            throw new BadRequestError('inventory.adjustment_reversal_revaluation_without_stock', { name: product.name });
          }
          newUnitCost = round6(Math.max(Number(product.cost) - revaluation / held, 0));
        }
        if (Math.abs(quantity) <= EPSILON && newUnitCost === null) continue;
        lines.push({
          productId: line.productId,
          position,
          countedQuantity: null,
          expectedQuantity: null,
          quantityChange: quantity,
          // A shortfall comes back at the cost it left at; a surplus leaves at average, which is
          // the only cost a shortfall can leave at (see `postLocked`).
          unitCost: quantity > 0 ? line.unitCost : null,
          newUnitCost,
        });
      }
      if (lines.length === 0) {
        throw new BadRequestError('inventory.adjustment_without_lines');
      }

      const reversal = await manager.save(
        manager.create(InventoryAdjustment, {
          organizationId,
          number: await this.allocateNumber(manager, organizationId, date),
          date,
          warehouseId: original.warehouseId,
          reason: dto.reason.trim(),
          notes: null,
          status: InventoryAdjustmentStatus.DRAFT,
          createdByUserId: actorUserId,
          reversesAdjustmentId: original.id,
          lines: lines.map((line) => manager.create(InventoryAdjustmentLine, line)),
        }),
      );
      // Re-read without its lines: saving the entity that still carries the unposted lines would
      // cascade them back over the values the posting writes.
      const unposted = await this.lockAdjustment(manager, reversal.id, organizationId);
      await this.postLocked(manager, organizationId, unposted, actorUserId, undefined, original.number);

      original.reversedByAdjustmentId = reversal.id;
      await manager.save(original);
      this.logger.log(`Ajuste ${original.number} revertido por ${unposted.number}.`);
      return unposted.id;
    });
    return this.findOne(reversalId, organizationId);
  }

  // ── Posting ─────────────────────────────────────────────────────────────────

  private async postLocked(
    manager: EntityManager,
    organizationId: string,
    adjustment: InventoryAdjustment,
    actorUserId: string | null,
    onBalanceChange?: BalanceChangeDecision,
    reverses?: string,
  ): Promise<void> {
    const lines = await manager.find(InventoryAdjustmentLine, {
      where: { adjustmentId: adjustment.id },
      order: { position: 'ASC', id: 'ASC' },
    });
    if (lines.length === 0) throw new BadRequestError('inventory.adjustment_without_lines');
    const date = toIsoDate(adjustment.date);
    await this.assertPostableDate(manager, organizationId, date);
    // The warehouse must still be open: a closed one takes no new stock and gives none.
    await this.ledger.resolveWarehouse(manager, organizationId, { warehouseId: adjustment.warehouseId });

    // Read every balance under the ledger's locks first, so the decision about moved balances is
    // made on all of them at once and nothing has moved yet if the posting is refused.
    const balances = new Map<string, { product: Product; balance: number }>();
    for (const line of lines) {
      balances.set(line.id, await this.ledger.lockedBalance(manager, organizationId, line.productId, adjustment.warehouseId));
    }
    const conflicts: BalanceConflict[] = [];
    for (const line of lines) {
      const { product, balance } = balances.get(line.id)!;
      if (line.countedQuantity === null || line.countedQuantity === undefined) continue;
      if (line.expectedQuantity === null || line.expectedQuantity === undefined) continue;
      if (Math.abs(balance - Number(line.expectedQuantity)) > EPSILON) {
        conflicts.push({
          productId: product.id,
          productName: product.name,
          sku: product.sku ?? null,
          counted: Number(line.countedQuantity),
          expected: Number(line.expectedQuantity),
          current: balance,
        });
      }
    }
    if (conflicts.length > 0 && !onBalanceChange) {
      throw new ConflictError('inventory.adjustment_balance_changed', {
        number: adjustment.number,
        count: conflicts.length,
        lines: conflicts,
      });
    }

    const movedAt = this.movementDate(date, await organizationToday(manager, organizationId));
    const reference = reverses
      ? `${adjustment.number} — ${adjustment.reason} (${reverses})`
      : `${adjustment.number} — ${adjustment.reason}`;
    const valued: Array<{ description: string; amount: number; kind: AdjustmentValueKind }> = [];
    let total = 0;

    for (const line of lines) {
      const { product, balance } = balances.get(line.id)!;
      if (product.kind === ProductKind.SERVICE) {
        throw new BadRequestError('inventory.service_holds_no_stock', { name: product.name });
      }
      const label = product.sku ? `${product.sku} · ${product.name}` : product.name;

      let change: number;
      if (line.countedQuantity !== null && line.countedQuantity !== undefined) {
        const expected = line.expectedQuantity;
        change =
          onBalanceChange === 'keep_difference' && expected !== null && expected !== undefined
            ? round6(Number(line.countedQuantity) - Number(expected))
            : round6(Number(line.countedQuantity) - balance);
      } else {
        change = round6(Number(line.quantityChange));
      }

      let quantityValue = 0;
      let movedAtCost = Number(product.cost);
      if (change > EPSILON) {
        // A surplus enters at the cost stated, or at average; either way it is re-averaged in.
        movedAtCost = line.unitCost !== null && line.unitCost !== undefined ? Number(line.unitCost) : Number(product.cost);
        const base = Math.max(Number(product.stock), 0);
        const cost = base + change > 0 ? (base * Number(product.cost) + change * movedAtCost) / (base + change) : movedAtCost;
        quantityValue = roundAmount(change * movedAtCost);
        product.cost = round6(cost);
        await manager.save(Product, product);
      } else if (change < -EPSILON) {
        // A loss leaves at average cost, valued as the difference between what the books carried
        // before and after — rounded the way the stock report rounds — so the ledger and the stock
        // valuation agree to the cent instead of drifting by one per line.
        const held = Math.max(Number(product.stock), 0);
        const cost = Number(product.cost);
        quantityValue = roundAmount(roundAmount((held + change) * cost) - roundAmount(held * cost));
      }

      if (Math.abs(change) > EPSILON) {
        await this.ledger.move(manager, organizationId, {
          productId: product.id,
          warehouseId: adjustment.warehouseId,
          quantity: change,
          unitCost: movedAtCost,
          type: 'ADJUSTMENT',
          reference,
          sourceType: 'inventory_adjustment',
          sourceId: adjustment.id,
          date: movedAt,
          value: quantityValue,
        });
      }

      // A new unit cost revalues everything held, in every warehouse — the cost is one per product.
      let revaluationValue = 0;
      if (line.newUnitCost !== null && line.newUnitCost !== undefined) {
        const fresh = await manager.findOneOrFail(Product, { where: { id: product.id, organizationId } });
        const newCost = round6(Number(line.newUnitCost));
        if (Math.abs(newCost - Number(fresh.cost)) > EPSILON) {
          const held = Math.max(Number(fresh.stock), 0);
          revaluationValue = roundAmount(roundAmount(held * newCost) - roundAmount(held * Number(fresh.cost)));
          fresh.cost = newCost;
          await manager.save(Product, fresh);
          await this.ledger.recordRevaluation(manager, organizationId, {
            productId: product.id,
            warehouseId: adjustment.warehouseId,
            newUnitCost: newCost,
            value: revaluationValue,
            reference,
            sourceType: 'inventory_adjustment',
            sourceId: adjustment.id,
            date: movedAt,
          });
        }
      }

      line.quantityBefore = balance;
      line.quantityChange = change;
      line.unitCost = movedAtCost;
      line.quantityValue = quantityValue;
      line.revaluationValue = revaluationValue;
      line.valueChange = roundAmount(quantityValue + revaluationValue);
      await manager.save(InventoryAdjustmentLine, line);
      total += line.valueChange;
      if (quantityValue !== 0) valued.push({ description: label, amount: quantityValue, kind: 'quantity' });
      if (revaluationValue !== 0) valued.push({ description: label, amount: revaluationValue, kind: 'revaluation' });
    }

    adjustment.valueChange = roundAmount(total);
    adjustment.journalEntryId = await this.posting.postAdjustment(
      manager,
      organizationId,
      { id: adjustment.id, number: adjustment.number, date, reason: adjustment.reason, lines: valued },
      actorUserId,
    );
    adjustment.status = InventoryAdjustmentStatus.POSTED;
    adjustment.postedAt = new Date();
    adjustment.postedByUserId = actorUserId;
    await manager.save(adjustment);
    this.logger.log(`Ajuste ${adjustment.number} contabilizado (${adjustment.valueChange}).`);
  }

  /**
   * When the stock moved, for the kardex: the document's date. Today's adjustment keeps the time of
   * day it was posted; one dated earlier lands at noon UTC of its own day — the kardex and the
   * journal entry then sit in the same day and the same period, which they did not when every
   * movement was stamped with the moment of posting.
   */
  private movementDate(date: string, today: string): Date | undefined {
    return date === today ? undefined : new Date(`${date}T12:00:00.000Z`);
  }

  // ── Dates ─────────────────────────────────────────────────────────────────

  private async dateReadiness(manager: EntityManager, organizationId: string, date: string): Promise<AdjustmentDateReadiness> {
    const iso = toIsoDate(date);
    const today = await organizationToday(manager, organizationId);
    const period = await postingPeriodCovering(manager, organizationId, iso, 'inventory');
    const view = period ? { name: period.name, open: !period.closed && !period.moduleClosed } : null;
    if (iso > today) return { period: view, problem: 'inventory.adjustment_date_in_future', params: { date: iso, today } };
    if (!period) return { period: null, problem: 'inventory.adjustment_date_without_period', params: { date: iso } };
    if (period.closed) {
      return { period: view, problem: 'inventory.adjustment_date_period_closed', params: { name: period.name } };
    }
    if (period.moduleClosed) {
      return { period: view, problem: 'inventory.adjustment_date_inventory_closed', params: { name: period.name } };
    }
    return { period: view, problem: null, params: {} };
  }

  /**
   * The date must be today or earlier, in a period the calendar already has, open for the ledger
   * and for inventory. Checked on save and again on posting (a period can close in between).
   */
  private async assertPostableDate(manager: EntityManager, organizationId: string, date: string): Promise<void> {
    const readiness = await this.dateReadiness(manager, organizationId, date);
    if (readiness.problem) throw new BadRequestError(readiness.problem, readiness.params);
  }

  private async accountsConfigured(manager: EntityManager, organizationId: string): Promise<boolean> {
    return inventoryAccountsConfigured(manager, organizationId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private allocateNumber(manager: EntityManager, organizationId: string, date: string): Promise<string> {
    return allocateDocumentNumber(manager, organizationId, DOCUMENT_SEQUENCE_SCOPE.INVENTORY_ADJUSTMENT, 'AJ', Number(date.slice(0, 4)));
  }

  private lineFrom(line: SaveInventoryAdjustmentDto['lines'][number], position: number): Partial<InventoryAdjustmentLine> {
    const counted = line.countedQuantity ?? null;
    return {
      productId: line.productId,
      position,
      countedQuantity: counted,
      expectedQuantity: counted === null ? null : (line.expectedQuantity ?? null),
      quantityChange: counted === null ? Number(line.quantityChange ?? 0) : 0,
      unitCost: line.unitCost ?? null,
      newUnitCost: line.newUnitCost ?? null,
    };
  }

  private async lockAdjustment(manager: EntityManager, id: string, organizationId: string): Promise<InventoryAdjustment> {
    const adjustment = await manager
      .createQueryBuilder(InventoryAdjustment, 'adjustment')
      .where('adjustment.id = :id', { id })
      .andWhere('adjustment.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write')
      .getOne();
    if (!adjustment) throw new NotFoundError('inventory.adjustment_not_found');
    return adjustment;
  }

  private async lockDraft(manager: EntityManager, id: string, organizationId: string): Promise<InventoryAdjustment> {
    const adjustment = await this.lockAdjustment(manager, id, organizationId);
    if (adjustment.status !== InventoryAdjustmentStatus.DRAFT) {
      throw new ConflictError('inventory.adjustment_not_draft', { number: adjustment.number });
    }
    return adjustment;
  }

  private async namesOf(manager: EntityManager, ids: Array<string | null>): Promise<Map<string, string>> {
    return userDisplayNames(manager, ids.filter((id): id is string => Boolean(id)));
  }

  private async numbersOf(manager: EntityManager, organizationId: string, ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const rows = await manager.find(InventoryAdjustment, { where: { id: In(wanted), organizationId }, select: { id: true, number: true } });
    return new Map(rows.map((row) => [row.id, row.number]));
  }

  /**
   * The warehouse is this company's and open; every product is a stocked, active good of this
   * company, once.
   */
  private async validate(manager: EntityManager, organizationId: string, dto: SaveInventoryAdjustmentDto): Promise<void> {
    const warehouse = await manager.findOne(Warehouse, { where: { id: dto.warehouseId, organizationId } });
    if (!warehouse) throw new BadRequestError('inventory.warehouse_not_found');
    if (!warehouse.isActive) throw new BadRequestError('inventory.warehouse_inactive', { name: warehouse.name });

    const ids = dto.lines.map((line) => line.productId);
    if (new Set(ids).size !== ids.length) throw new BadRequestError('inventory.document_repeats_product');
    for (const line of dto.lines) {
      const hasCount = line.countedQuantity !== undefined && line.countedQuantity !== null;
      const hasChange = line.quantityChange !== undefined && line.quantityChange !== null && Number(line.quantityChange) !== 0;
      const hasCost = line.newUnitCost !== undefined && line.newUnitCost !== null;
      if (hasCount && hasChange) throw new BadRequestError('inventory.adjustment_line_count_or_change');
      if (!hasCount && !hasChange && !hasCost) throw new BadRequestError('inventory.adjustment_line_empty');
    }
    const products = await manager.find(Product, {
      where: { id: In(ids), organizationId },
      select: { id: true, name: true, kind: true, status: true },
    });
    if (products.length !== ids.length) throw new BadRequestError('inventory.product_not_found_in_document');
    const service = products.find((product) => product.kind === ProductKind.SERVICE);
    if (service) throw new BadRequestError('inventory.service_holds_no_stock', { name: service.name });
    // An inactive product is out of the catalogue. Writing off what is left of it is exactly what
    // an adjustment is for; bringing stock back in or revaluing it is a decision to reactivate it
    // first, not something an adjustment should do in passing.
    for (const line of dto.lines) {
      const product = products.find((candidate) => candidate.id === line.productId);
      if (product?.status !== ProductStatus.INACTIVE) continue;
      const writesOff =
        (line.countedQuantity !== undefined && line.countedQuantity !== null && Number(line.countedQuantity) === 0) ||
        (line.quantityChange !== undefined && line.quantityChange !== null && Number(line.quantityChange) < 0);
      if (!writesOff || (line.newUnitCost !== undefined && line.newUnitCost !== null)) {
        throw new BadRequestError('inventory.adjustment_product_inactive', { name: product.name });
      }
    }
  }
}
