import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { PERMISSIONS } from '../shared/permissions';
import { PosService } from './pos.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { ProcessSaleDto } from './dto/process-sale.dto';

/**
 * The till's HTTP surface. Everything is tenant-scoped from the authenticated principal — a
 * terminal cannot open a shift or ring a sale for another organization.
 */
@Controller('pos')
@UseGuards(JwtAuthGuard)
export class PosController {
  constructor(private readonly pos: PosService) {}

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
  closeShift(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pos.closeShift(user.organizationId, id, dto);
  }

  @Post('sales')
  @HasPermission(PERMISSIONS.POS_OPERATE)
  processSale(@Body() dto: ProcessSaleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.processSale(user.organizationId, dto);
  }

  @Get('sales')
  @HasPermission(PERMISSIONS.POS_VIEW)
  listSales(@Query('shiftId') shiftId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pos.listSales(user.organizationId, shiftId || undefined);
  }
}
