import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PosShift, PosShiftStatus } from './entities/pos-shift.entity';
import { PosSale, PosSaleStatus } from './entities/pos-sale.entity';
import { InventoryService } from '../inventory/inventory.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ProcessSaleDto } from './dto/process-sale.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Point of sale: shift lifecycle and till transactions.
 *
 * Consolidated from special-enigma's POS domain (open-shift + process-sale use-cases) into a single
 * tenant-scoped service on the platform's TypeORM data source. A sale is atomic: the same
 * transaction that records the ticket decrements catalogue stock via the existing
 * {@link InventoryService.decreaseStock} (row-locked, tenant-scoped), so a sale and the stock it
 * consumed can never disagree, and an oversold last unit rolls the whole ticket back.
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

  async openShift(
    organizationId: string,
    userId: string,
    dto: OpenShiftDto,
  ): Promise<PosShift> {
    const existing = await this.getActiveShift(organizationId, dto.terminalId);
    if (existing) {
      throw new ConflictException('There is already an active shift for this terminal.');
    }
    const shift = this.shifts.create({
      organizationId,
      userId,
      terminalId: dto.terminalId,
      openingBalance: dto.openingBalance,
      status: PosShiftStatus.OPEN,
    });
    return this.shifts.save(shift);
  }

  async closeShift(
    organizationId: string,
    shiftId: string,
    dto: CloseShiftDto,
  ): Promise<PosShift> {
    const shift = await this.shifts.findOne({ where: { id: shiftId, organizationId } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === PosShiftStatus.CLOSED) {
      throw new BadRequestException('Shift is already closed');
    }
    shift.status = PosShiftStatus.CLOSED;
    shift.closingBalance = dto.closingBalance;
    shift.closedAt = new Date();
    return this.shifts.save(shift);
  }

  async processSale(
    organizationId: string,
    dto: ProcessSaleDto,
  ): Promise<PosSale> {
    const shift = await this.getActiveShift(organizationId, dto.terminalId);
    if (!shift) {
      throw new BadRequestException('No open shift for this terminal. Open a shift before selling.');
    }

    return this.dataSource.transaction(async (manager) => {
      // Decrement catalogue stock for every line that refers to a real product. Ad-hoc lines
      // (non-UUID productId, e.g. a manual "misc" item) carry no inventory and are skipped.
      for (const item of dto.items) {
        if (UUID_RE.test(item.productId)) {
          await this.inventory.decreaseStock(item.productId, item.quantity, manager, organizationId);
        }
      }

      const sale = manager.create(PosSale, {
        organizationId,
        terminalId: dto.terminalId,
        shiftId: shift.id,
        items: dto.items,
        subtotal: dto.subtotal,
        tax: dto.tax,
        total: dto.total,
        paymentMethod: dto.paymentMethod ?? null,
        customerName: dto.customerName ?? null,
        status: PosSaleStatus.PAID,
      });
      const saved = await manager.save(PosSale, sale);

      shift.salesTotal = Number(shift.salesTotal) + Number(dto.total);
      shift.salesCount += 1;
      await manager.save(PosShift, shift);

      this.logger.log(`POS sale ${saved.id} on terminal ${dto.terminalId} (${dto.total})`);
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
}
