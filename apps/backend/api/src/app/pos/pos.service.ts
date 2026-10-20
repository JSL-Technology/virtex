import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import { PosShift, PosShiftStatus } from './entities/pos-shift.entity';
import { PosPayment, PosSale, PosSaleItem, PosSaleStatus } from './entities/pos-sale.entity';
import { InventoryService } from '../inventory/inventory.service';
import {
  SellableCatalogueItem,
  findSellableProduct,
  isStockedProduct,
  listSellableCatalogue,
  standardSalesTaxRate,
} from '../inventory/contracts/sellable-product.contract';
import { organizationBaseCurrency } from '../organizations/contracts/base-currency.contract';
import { organizationFiscalIdentity } from '../organizations/contracts/fiscal-identity.contract';
import { findTaxScheme } from '../localization/contracts/country-profile.contract';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ProcessSaleDto } from './dto/process-sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { roundAmount, sumAmounts } from '../common/money';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';
import { applyBranchScope, loadBranchScope, resolveDocumentBranch } from '../organizations/contracts/branch.contract';

/** Payment methods that put money in the drawer. A sale that names none is a cash sale. */
const CASH_METHODS = new Set(['cash', 'efectivo', 'dinheiro']);

/** The tender methods a report breaks takings down by. */
const TENDER_METHODS = ['cash', 'card', 'transfer', 'other'] as const;
type TenderMethod = (typeof TENDER_METHODS)[number];

/** What a till needs to know about the company it sells for, before the first sale. */
export interface PosContext {
  /** Printed on the ticket's header. */
  organization: { legalName: string | null; taxId: string | null; country: string | null };
  /** ISO 4217 — every amount the till shows is in it. */
  currency: string;
  /** The rate a taxed product with no rate of its own is charged at, as a fraction. */
  standardTaxRate: number;
  /** True where the market has no national rate and the tenant must configure one (US, Brazil). */
  taxRequiresConfiguration: boolean;
}

/**
 * A shift's report: the X report while it is open, the Z report once closed. Everything a cashier
 * and a supervisor reconcile the drawer and the card terminal with.
 */
export interface PosShiftReport {
  shift: PosShift;
  /** Sales that stand (voids excluded). */
  salesCount: number;
  subtotal: number;
  tax: number;
  total: number;
  /** Takings per tender, net of change: what each channel (drawer, card terminal, bank) should hold. */
  byMethod: Record<TenderMethod, number>;
  /** Units sold, all lines. */
  itemsSold: number;
  /** Average ticket. Zero with no sales. */
  averageTicket: number;
  voidedCount: number;
  voidedTotal: number;
  /** Opening float plus cash kept. What the drawer should hold now (open) or held at close. */
  expectedCash: number;
  /** The best sellers on the shift, by amount. */
  topProducts: Array<{ productId: string; productName: string; quantity: number; total: number }>;
}

/** The largest difference, in the currency's units, still treated as the same amount. */
const AMOUNT_TOLERANCE = 0.005;

/**
 * The point of sale, with the server as the authority on every amount.
 *
 * ## What changed, and why
 *
 * The till used to send the price of each line, the subtotal, the tax and the total, and the
 * server stored them as sent. Nothing compared them with the catalogue or with each other: a sale
 * of a 1,000.00 item could be rung at 0.01, a total could disagree with its own lines, and a line
 * whose product id was not a uuid skipped the stock movement entirely. For the secondary app that
 * handles cash, "the browser decides what things cost" was the whole control.
 *
 * Now the till says WHICH products and HOW MANY, and what amounts it SHOWED the customer. The
 * server prices every line from the catalogue (price, tax treatment and rate), moves stock for
 * goods, computes the totals, and refuses the sale if what the customer was shown differs from
 * what the catalogue says — so nobody is charged an amount they did not see, and nobody can
 * choose the amount they are charged.
 *
 * Shifts belong to the cashier who opened them. Ringing on, or closing, someone else's shift takes
 * `pos:manage_shifts`. Closing computes the expected drawer and records the variance.
 */
@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(
    @InjectRepository(PosShift) private readonly shifts: Repository<PosShift>,
    @InjectRepository(PosSale) private readonly sales: Repository<PosSale>,
    private readonly inventory: InventoryService,
    private readonly dataSource: DataSource,
  ) {}

  getActiveShift(organizationId: string, terminalId: string): Promise<PosShift | null> {
    return this.shifts.findOne({
      where: { organizationId, terminalId, status: PosShiftStatus.OPEN },
    });
  }

  /**
   * Open a shift. At most one per terminal: the database enforces it with a partial unique index,
   * so two concurrent opens cannot both succeed the way two passes of a read-then-insert could.
   */
  async openShift(
    organizationId: string,
    userId: string,
    dto: OpenShiftDto,
  ): Promise<PosShift> {
    const existing = await this.getActiveShift(organizationId, dto.terminalId);
    if (existing) {
      throw new ConflictError('pos.there_already_active_shift_for_this_terminal');
    }
    const branchId = await resolveDocumentBranch(this.dataSource.manager, organizationId, userId, dto.branchId);
    const shift = this.shifts.create({
      organizationId,
      branchId,
      userId,
      terminalId: dto.terminalId,
      openingBalance: roundAmount(dto.openingBalance),
      status: PosShiftStatus.OPEN,
    });
    try {
      return await this.shifts.save(shift);
    } catch (error) {
      if (PosService.isUniqueViolation(error)) {
        throw new ConflictError('pos.there_already_active_shift_for_this_terminal');
      }
      throw error;
    }
  }

  /**
   * Close a shift and cash it up: what the drawer should hold, what was counted, and the difference.
   */
  async closeShift(
    organizationId: string,
    shiftId: string,
    dto: CloseShiftDto,
    actor: AuthenticatedUser,
  ): Promise<PosShift> {
    return this.dataSource.transaction(async (manager) => {
      const shift = await this.lockShift(manager, organizationId, { id: shiftId });
      if (!shift) throw new NotFoundError('pos.shift_not_found');
      if (shift.status === PosShiftStatus.CLOSED) {
        throw new BadRequestError('pos.shift_already_closed');
      }
      PosService.assertMayActOnShift(shift, actor);

      const counted = roundAmount(dto.closingBalance);
      const expected = sumAmounts([Number(shift.openingBalance), Number(shift.cashSalesTotal)]);

      shift.status = PosShiftStatus.CLOSED;
      shift.closingBalance = counted;
      shift.expectedBalance = expected;
      shift.closingVariance = roundAmount(counted - expected);
      shift.closedAt = new Date();
      shift.closedById = actor.id;
      const saved = await manager.save(PosShift, shift);

      if (shift.closingVariance !== 0) {
        this.logger.warn(
          {
            event: 'pos_shift_variance',
            organizationId,
            shiftId: shift.id,
            terminalId: shift.terminalId,
            expected,
            counted,
            variance: shift.closingVariance,
          },
          'POS shift closed with a cash variance',
        );
      }
      return saved;
    });
  }

  /**
   * Ring a sale, priced by the server.
   *
   * Everything happens in one transaction, with the shift row locked: the stock movements, the
   * sale, and the shift's running totals either all happen or none do, and two sales on the same
   * shift cannot overwrite each other's contribution to its totals.
   */
  async processSale(
    organizationId: string,
    cashier: AuthenticatedUser,
    dto: ProcessSaleDto,
  ): Promise<PosSale> {
    return this.dataSource.transaction(async (manager) => {
      const shift = await this.lockShift(manager, organizationId, {
        terminalId: dto.terminalId,
        status: PosShiftStatus.OPEN,
      });
      if (!shift) {
        throw new BadRequestError('pos.no_open_shift');
      }
      PosService.assertMayActOnShift(shift, cashier);

      // The sale's id is chosen before its stock moves, so the kardex can point at the sale.
      const saleId = randomUUID();
      const lines: PosSaleItem[] = [];
      for (const item of dto.items) {
        const product = await findSellableProduct(manager, organizationId, item.productId);
        if (!product) {
          throw new BadRequestError('pos.product_not_available', { productId: item.productId });
        }

        const price = roundAmount(product.price);
        if (Math.abs(price - item.price) > AMOUNT_TOLERANCE) {
          throw new ConflictError('pos.prices_changed', { productId: product.id });
        }

        const taxRate = product.taxRate;
        const lineSubtotal = roundAmount(price * item.quantity);
        const lineTax = roundAmount(lineSubtotal * taxRate);

        if (product.stocked) {
          await this.inventory.decreaseStock(product.id, item.quantity, manager, organizationId, {
            // The till's shift belongs to a branch; its warehouse is where the goods leave from.
            place: { branchId: shift.branchId },
            type: 'SALE_DISPATCH',
            reference: `POS ${dto.terminalId}`,
            sourceType: 'pos_sale',
            sourceId: saleId,
          });
        }

        lines.push({
          productId: product.id,
          productName: product.name,
          price,
          quantity: item.quantity,
          taxRate,
          lineSubtotal,
          lineTax,
        });
      }

      const subtotal = sumAmounts(lines.map((line) => line.lineSubtotal));
      const tax = sumAmounts(lines.map((line) => line.lineTax));
      const total = sumAmounts([subtotal, tax]);

      // The customer must be charged what they were shown. A difference means the till's copy of
      // the catalogue is stale — refused, so the cashier reloads and shows the real amount.
      if (
        Math.abs(subtotal - dto.subtotal) > AMOUNT_TOLERANCE ||
        Math.abs(tax - dto.tax) > AMOUNT_TOLERANCE ||
        Math.abs(total - dto.total) > AMOUNT_TOLERANCE
      ) {
        throw new ConflictError('pos.totals_changed', { subtotal, tax, total });
      }

      const tender = PosService.settleTenders(dto, total);
      const paymentMethod = tender.method ?? (dto.paymentMethod?.trim().toLowerCase() || null);
      const sale = manager.create(PosSale, {
        id: saleId,
        organizationId,
        terminalId: dto.terminalId,
        shiftId: shift.id,
        // A till sale belongs to the branch the till stands in.
        branchId: shift.branchId,
        cashierId: cashier.id,
        items: lines,
        subtotal,
        tax,
        total,
        paymentMethod,
        customerName: dto.customerName?.trim() || null,
        payments: tender.payments,
        amountTendered: tender.amountTendered,
        changeDue: tender.changeDue,
        status: PosSaleStatus.PAID,
      });
      const saved = await manager.save(PosSale, sale);

      shift.salesTotal = sumAmounts([Number(shift.salesTotal), total]);
      shift.salesCount += 1;
      // Only what stays in the drawer counts as cash: the cash tendered minus the change. A mixed
      // sale paid partly by card used to be counted whole as cash, and the drawer never squared.
      const cashKept = tender.payments.length
        ? tender.cashKept
        : paymentMethod === null || CASH_METHODS.has(paymentMethod)
          ? total
          : 0;
      if (cashKept > 0) {
        shift.cashSalesTotal = sumAmounts([Number(shift.cashSalesTotal), cashKept]);
      }
      await manager.save(PosShift, shift);

      this.logger.log(`POS sale ${saved.id} on terminal ${dto.terminalId} (${total})`);
      return saved;
    });
  }

  /** The till's catalogue, priced and taxed as the server will charge it. */
  catalogue(organizationId: string): Promise<SellableCatalogueItem[]> {
    return listSellableCatalogue(this.dataSource.manager, organizationId);
  }

  /** Currency, standard rate and the company's fiscal identity, for the till and its tickets. */
  async context(organizationId: string): Promise<PosContext> {
    const manager = this.dataSource.manager;
    const [identity, currency, standardTaxRate] = await Promise.all([
      organizationFiscalIdentity(manager, organizationId),
      organizationBaseCurrency(manager, organizationId),
      standardSalesTaxRate(manager, organizationId),
    ]);
    const country = identity?.country ?? null;
    return {
      organization: {
        legalName: identity?.legalName ?? null,
        taxId: identity?.taxId ?? null,
        country,
      },
      currency,
      standardTaxRate,
      taxRequiresConfiguration: country ? findTaxScheme(country)?.configurationRequired ?? true : true,
    };
  }

  /** One sale, for a reprint. */
  async getSale(organizationId: string, saleId: string): Promise<PosSale> {
    const sale = await this.sales.findOne({ where: { id: saleId, organizationId } });
    if (!sale) throw new NotFoundError('pos.sale_not_found');
    return sale;
  }

  /**
   * The X report of an open shift, or the Z report of a closed one.
   *
   * Computed from the sales themselves rather than from the shift's running totals, so the report
   * breaks the takings down (by tender, by product) and is its own cross-check of those totals.
   */
  async shiftReport(organizationId: string, shiftId: string): Promise<PosShiftReport> {
    const shift = await this.shifts.findOne({ where: { id: shiftId, organizationId } });
    if (!shift) throw new NotFoundError('pos.shift_not_found');
    const sales = await this.sales.find({ where: { organizationId, shiftId } });
    return PosService.buildReport(shift, sales);
  }

  /** The report's arithmetic, apart from the database so it can be checked on its own. */
  static buildReport(shift: PosShift, sales: PosSale[]): PosShiftReport {
    const standing = sales.filter((sale) => sale.status === PosSaleStatus.PAID);
    const voided = sales.filter((sale) => sale.status === PosSaleStatus.CANCELLED);
    const byMethod: Record<TenderMethod, number> = { cash: 0, card: 0, transfer: 0, other: 0 };
    const products = new Map<string, { productId: string; productName: string; quantity: number; total: number }>();
    let itemsSold = 0;

    for (const sale of standing) {
      for (const [method, amount] of Object.entries(PosService.tenderBreakdown(sale))) {
        byMethod[method as TenderMethod] = sumAmounts([byMethod[method as TenderMethod], amount]);
      }
      for (const line of sale.items ?? []) {
        itemsSold += Number(line.quantity) || 0;
        const entry = products.get(line.productId) ?? {
          productId: line.productId,
          productName: line.productName,
          quantity: 0,
          total: 0,
        };
        entry.quantity += Number(line.quantity) || 0;
        entry.total = sumAmounts([entry.total, Number(line.lineSubtotal ?? 0) + Number(line.lineTax ?? 0)]);
        products.set(line.productId, entry);
      }
    }

    const total = sumAmounts(standing.map((sale) => Number(sale.total)));
    return {
      shift,
      salesCount: standing.length,
      subtotal: sumAmounts(standing.map((sale) => Number(sale.subtotal))),
      tax: sumAmounts(standing.map((sale) => Number(sale.tax))),
      total,
      byMethod,
      itemsSold,
      averageTicket: standing.length ? roundAmount(total / standing.length) : 0,
      voidedCount: voided.length,
      voidedTotal: sumAmounts(voided.map((sale) => Number(sale.total))),
      expectedCash: sumAmounts([Number(shift.openingBalance), byMethod.cash]),
      topProducts: [...products.values()].sort((a, b) => b.total - a.total).slice(0, 10),
    };
  }

  /**
   * Void a sale: it stops counting in the takings and its goods go back on the shelf.
   *
   * A supervisor's act (`pos:manage_shifts`, enforced by the route), with a reason, and only while
   * the shift is still open — a closed shift has been cashed up, and changing it afterwards would
   * make its Z report a fiction. Correcting a closed shift's sale is a return, not a void.
   *
   * One transaction with the sale and the shift locked: the stock, the sale's status and the
   * shift's totals move together, and a sale cannot be voided twice by two supervisors at once.
   */
  async voidSale(
    organizationId: string,
    saleId: string,
    dto: VoidSaleDto,
    actor: AuthenticatedUser,
  ): Promise<PosSale> {
    return this.dataSource.transaction(async (manager) => {
      const sale = await manager
        .createQueryBuilder(PosSale, 'sale')
        .where('sale.organizationId = :organizationId', { organizationId })
        .andWhere('sale.id = :saleId', { saleId })
        .setLock('pessimistic_write')
        .getOne();
      if (!sale) throw new NotFoundError('pos.sale_not_found');
      if (sale.status !== PosSaleStatus.PAID) throw new BadRequestError('pos.sale_already_voided');

      const shift = sale.shiftId ? await this.lockShift(manager, organizationId, { id: sale.shiftId }) : null;
      if (!shift || shift.status !== PosShiftStatus.OPEN) {
        throw new BadRequestError('pos.sale_shift_closed');
      }

      for (const line of sale.items ?? []) {
        if (!(await isStockedProduct(manager, organizationId, line.productId))) continue;
        await this.inventory.increaseStock(line.productId, Number(line.quantity), manager, organizationId, {
          place: { branchId: sale.branchId },
          type: 'SALE_RETURN',
          reference: `POS void ${sale.terminalId}`,
          sourceType: 'pos_sale_void',
          sourceId: sale.id,
        });
      }

      sale.status = PosSaleStatus.CANCELLED;
      sale.voidedAt = new Date();
      sale.voidedById = actor.id;
      sale.voidReason = dto.reason.trim();
      const saved = await manager.save(PosSale, sale);

      const cashKept = PosService.tenderBreakdown(sale).cash ?? 0;
      shift.salesTotal = roundAmount(Number(shift.salesTotal) - Number(sale.total));
      shift.salesCount = Math.max(0, shift.salesCount - 1);
      shift.cashSalesTotal = roundAmount(Number(shift.cashSalesTotal) - cashKept);
      shift.voidedTotal = sumAmounts([Number(shift.voidedTotal ?? 0), Number(sale.total)]);
      shift.voidedCount = (shift.voidedCount ?? 0) + 1;
      await manager.save(PosShift, shift);

      this.logger.warn(
        {
          event: 'pos_sale_voided',
          organizationId,
          saleId: sale.id,
          shiftId: shift.id,
          total: sale.total,
          voidedBy: actor.id,
        },
        'POS sale voided',
      );
      return saved;
    });
  }

  /**
   * What a sale put in each channel, net of change. A sale from before tenders were recorded counts
   * whole under the method it named (cash when it named none), as `processSale` counted it.
   */
  private static tenderBreakdown(sale: Pick<PosSale, 'payments' | 'paymentMethod' | 'total' | 'changeDue'>): Partial<Record<TenderMethod, number>> {
    const payments = sale.payments ?? [];
    if (payments.length === 0) {
      const method = sale.paymentMethod?.toLowerCase() ?? null;
      const key: TenderMethod =
        method === null || CASH_METHODS.has(method)
          ? 'cash'
          : (TENDER_METHODS as readonly string[]).includes(method)
            ? (method as TenderMethod)
            : 'other';
      return { [key]: Number(sale.total) };
    }
    const out: Partial<Record<TenderMethod, number>> = {};
    for (const payment of payments) {
      out[payment.method] = sumAmounts([out[payment.method] ?? 0, Number(payment.amount)]);
    }
    // The change came out of the cash.
    if (Number(sale.changeDue) > 0) out.cash = roundAmount((out.cash ?? 0) - Number(sale.changeDue));
    return out;
  }

  async listSales(
    organizationId: string,
    shiftId?: string,
    options: { branchId?: string; actorUserId?: string } = {},
  ): Promise<PosSale[]> {
    const query = this.sales
      .createQueryBuilder('sale')
      .where('sale.organizationId = :organizationId', { organizationId });
    if (shiftId) query.andWhere('sale.shiftId = :shiftId', { shiftId });
    if (options.actorUserId || options.branchId) {
      const scope = await loadBranchScope(this.dataSource.manager, organizationId, options.actorUserId ?? null);
      applyBranchScope(query, 'sale', scope, options.branchId);
    }
    return query.orderBy('sale.createdAt', 'DESC').take(200).getMany();
  }

  /** The shift, locked for the rest of the transaction, scoped to the tenant. */
  private lockShift(
    manager: EntityManager,
    organizationId: string,
    where: { id?: string; terminalId?: string; status?: PosShiftStatus },
  ): Promise<PosShift | null> {
    const query = manager
      .createQueryBuilder(PosShift, 'shift')
      .where('shift.organizationId = :organizationId', { organizationId })
      .setLock('pessimistic_write');
    if (where.id) query.andWhere('shift.id = :id', { id: where.id });
    if (where.terminalId) query.andWhere('shift.terminalId = :terminalId', { terminalId: where.terminalId });
    if (where.status) query.andWhere('shift.status = :status', { status: where.status });
    return query.getOne();
  }

  /**
   * A shift is its cashier's. Somebody else may ring on it or close it only as a supervisor.
   */
  private static assertMayActOnShift(shift: PosShift, actor: AuthenticatedUser): void {
    if (shift.userId === actor.id) return;
    if (hasPermission(actor.permissions ?? [], [PERMISSIONS.POS_MANAGE_SHIFTS])) return;
    throw new ForbiddenError('pos.shift_belongs_to_another_cashier');
  }

  /**
   * Checks the tenders against the total and works out the change (QA C-04).
   *
   * The tenders must cover the sale; only cash may exceed it, and the excess is the change — card
   * and transfer are charged for the exact amount, so an overpayment on them is a keying mistake.
   * With no tenders (an older till) nothing is computed and the sale behaves as before.
   */
  static settleTenders(
    dto: Pick<ProcessSaleDto, 'payments'>,
    total: number,
  ): { method: string | null; payments: PosPayment[]; amountTendered: number | null; changeDue: number; cashKept: number } {
    const payments = (dto.payments ?? []).map((payment) => ({
      method: payment.method,
      amount: roundAmount(payment.amount),
      reference: payment.reference?.trim() || null,
    }));
    if (payments.length === 0) {
      return { method: null, payments: [], amountTendered: null, changeDue: 0, cashKept: 0 };
    }
    const paid = sumAmounts(payments.map((payment) => payment.amount));
    const cash = sumAmounts(payments.filter((payment) => payment.method === 'cash').map((p) => p.amount));
    if (paid + AMOUNT_TOLERANCE < total) {
      throw new BadRequestError('pos.payment_short', { total, paid });
    }
    const changeDue = roundAmount(Math.max(paid - total, 0));
    if (changeDue > cash + AMOUNT_TOLERANCE) {
      throw new BadRequestError('pos.payment_overpaid_non_cash', { total, paid });
    }
    const methods = [...new Set(payments.map((payment) => payment.method))];
    return {
      method: methods.length > 1 ? 'mixed' : methods[0],
      payments,
      amountTendered: cash > 0 ? cash : null,
      changeDue,
      cashKept: roundAmount(cash - changeDue),
    };
  }

  private static isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505'
    );
  }
}
