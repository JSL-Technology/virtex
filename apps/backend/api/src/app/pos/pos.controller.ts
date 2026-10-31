import { BranchScoped } from '../organizations/contracts/branch-scope.interceptor';
import { PosShift } from './entities/pos-shift.entity';
import { PosSale } from './entities/pos-sale.entity';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { PosService } from './pos.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ProcessSaleDto } from './dto/process-sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';
import { DataSource } from 'typeorm';
import { PosFiscalService } from './pos-fiscal.service';
import { UpdatePosSettingsDto } from './dto/pos-settings.dto';

/**
 * The till's HTTP surface. Everything is tenant-scoped from the authenticated principal — a
 * terminal cannot open a shift or ring a sale for another organization.
 */
@Controller('pos')
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly fiscal: PosFiscalService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The till's catalogue: active products, priced and taxed exactly as a sale will be. Behind
   * `pos:view`, so a cashier needs no back-office catalogue permission to sell.
   */
  @Get('catalog')
  @HasPermission(PERMISSIONS.POS_VIEW)
  catalogue(@CurrentUser() user: AuthenticatedUser) {
    return this.pos.catalogue(user.organizationId);
  }

  /** Currency, standard rate and the company's identity for the ticket header. */
  @Get('context')
  @HasPermission(PERMISSIONS.POS_VIEW)
  context(@CurrentUser() user: AuthenticatedUser) {
    return this.pos.context(user.organizationId);
  }

  @Get('shifts/active')
  @HasPermission(PERMISSIONS.POS_VIEW)
  activeShift(@Query('terminalId') terminalId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.getActiveShift(user.organizationId, terminalId ?? 'main');
  }

  @Post('shifts')
  @HasPermission(PERMISSIONS.POS_OPERATE)
  openShift(@Body() dto: OpenShiftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.openShift(user.organizationId, user.id, dto);
  }

  @Post('shifts/:id/close')
  @HasPermission(PERMISSIONS.POS_OPERATE)
  @BranchScoped(PosShift)
  closeShift(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.closeShift(user.organizationId, id, dto, user);
  }

  /** The X report of an open shift, the Z report of a closed one. */
  @Get('shifts/:id/report')
  @HasPermission(PERMISSIONS.POS_VIEW)
  @BranchScoped(PosShift)
  shiftReport(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.shiftReport(user.organizationId, id);
  }

  /**
   * Idempotent: a till on a flaky connection retries, and a sale that commits and then loses its
   * response must not be rung — and its stock moved — a second time.
   */
  @Post('sales')
  @Idempotent()
  @HasPermission(PERMISSIONS.POS_OPERATE)
  processSale(@Body() dto: ProcessSaleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.processSale(user.organizationId, user, dto);
  }

  @Get('sales')
  @HasPermission(PERMISSIONS.POS_VIEW)
  listSales(
    @Query('shiftId') shiftId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('branchId', new ParseUUIDPipe({ optional: true })) branchId?: string,
  ) {
    return this.pos.listSales(user.organizationId, shiftId || undefined, { branchId, actorUserId: user.id });
  }

  /**
   * The sale's fiscal document as the ticket prints it — e-NCF, security code and the timbre QR.
   * The till polls this after a sale until the document is signed (a second or two).
   */
  @Get('sales/:id/fiscal')
  @HasPermission(PERMISSIONS.POS_VIEW)
  @BranchScoped(PosSale)
  fiscalStatus(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.fiscalStatus(user.organizationId, id);
  }

  /** Which treasury accounts the till's takings land in, and whether each sale is a fiscal document. */
  @Get('settings')
  @HasPermission(PERMISSIONS.POS_VIEW)
  settings(@CurrentUser() user: AuthenticatedUser) {
    return this.fiscal.settings(user.organizationId);
  }

  @Put('settings')
  @HasPermission(PERMISSIONS.POS_MANAGE_SHIFTS)
  updateSettings(@Body() dto: UpdatePosSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dataSource.transaction((manager) =>
      this.fiscal.updateSettings(user.organizationId, dto, manager),
    );
  }

  @Get('sales/:id')
  @HasPermission(PERMISSIONS.POS_VIEW)
  @BranchScoped(PosSale)
  getSale(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.getSale(user.organizationId, id);
  }

  /**
   * Void a sale on a shift that is still open: a supervisor's act, with a reason. The stock goes
   * back and the shift's takings drop by the sale; the void is kept on the shift's report.
   */
  @Post('sales/:id/void')
  @Idempotent()
  @HasPermission(PERMISSIONS.POS_MANAGE_SHIFTS)
  @BranchScoped(PosSale)
  voidSale(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: VoidSaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.voidSale(user.organizationId, id, dto, user);
  }
}
