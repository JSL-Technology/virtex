import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import { PosShift, PosShiftStatus } from './entities/pos-shift.entity';
import { PosSale, PosSaleItem, PosSaleStatus } from './entities/pos-sale.entity';
import { InventoryService } from '../inventory/inventory.service';
import { findSellableProduct } from '../inventory/contracts/sellable-product.contract';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ProcessSaleDto } from './dto/process-sale.dto';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { roundAmount, sumAmounts } from '../common/money';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../i18n/localized.exception';

/** Payment methods that put money in the drawer. A sale that names none is a cash sale. */
const CASH_METHODS = new Set(['cash', 'efectivo', 'dinheiro']);

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
    const shift = this.shifts.create({
      organizationId,
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
          await this.inventory.decreaseStock(product.id, item.quantity, manager, organizationId);
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

      const paymentMethod = dto.paymentMethod?.trim().toLowerCase() || null;
      const sale = manager.create(PosSale, {
        organizationId,
        terminalId: dto.terminalId,
        shiftId: shift.id,
        cashierId: cashier.id,
        items: lines,
        subtotal,
        tax,
        total,
        paymentMethod,
        customerName: dto.customerName?.trim() || null,
        status: PosSaleStatus.PAID,
      });
      const saved = await manager.save(PosSale, sale);

      shift.salesTotal = sumAmounts([Number(shift.salesTotal), total]);
      shift.salesCount += 1;
      if (paymentMethod === null || CASH_METHODS.has(paymentMethod)) {
        shift.cashSalesTotal = sumAmounts([Number(shift.cashSalesTotal), total]);
      }
      await manager.save(PosShift, shift);

      this.logger.log(`POS sale ${saved.id} on terminal ${dto.terminalId} (${total})`);
      return saved;
    });
  }

  listSales(organizationId: string, shiftId?: string): Promise<PosSale[]> {
    return this.sales.find({
      where: shiftId ? { organizationId, shiftId } : { organizationId },
      order: { createdAt: 'DESC' },
      take: 200,
    });
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

  private static isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { driverError?: { code?: string } }).driverError?.code === '23505'
    );
  }
}
