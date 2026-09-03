
import {
  Controller,
  Post,
  Get,
  Param,
  ParseUUIDPipe,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { PeriodClosingService } from './period-closing.service';
import { ClosePeriodDto } from './dto/close-period.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { ModulePeriodDto } from './dto/module-period.dto';
import { LockAccountInPeriodDto } from './dto/lock-account-period.dto';
import { ReopenPeriodDto } from './dto/reopen-period.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ListPeriodsQueryDto } from './dto/list-periods-query.dto';
import { ClosingChecklistService } from './closing-checklist.service';

@ApiTags('Accounting')
@ApiBearerAuth()
@Controller('accounting')
@UseGuards(JwtAuthGuard)
export class AccountingController {
  constructor(
    private readonly periodClosingService: PeriodClosingService,
    private readonly closingChecklistService: ClosingChecklistService,
  ) {}

  @Get('periods')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Lista los períodos contables de la organización.' })
  @ApiResponse({ status: 200, description: 'Períodos contables de la organización.' })
  listPeriods(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPeriodsQueryDto,
  ) {
    return this.periodClosingService.listPeriods(user.organizationId, { year: query.year });
  }

  /**
   * What still stands between the tenant and closing this period.
   *
   * `ClosingChecklistService` computes every item from the tenant's own data — unposted entries,
   * unreconciled bank lines, pending approvals — and had no controller, so nothing could reach it.
   * The screen that should have shown it displayed seven hardcoded English task names instead.
   */
  @Get('periods/:periodId/closing-checklist')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Checklist de cierre calculado para un período contable.' })
  @ApiResponse({ status: 200, description: 'Puntos pendientes para cerrar el período.' })
  @ApiResponse({ status: 404, description: 'Período no encontrado.' })
  closingChecklist(
    @Param('periodId', ParseUUIDPipe) periodId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.closingChecklistService.getChecklist(periodId, user.organizationId);
  }

  @Post('close-period')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_PERIOD)
  @ApiOperation({ summary: 'Cierra un período contable general.' })
  @ApiResponse({ status: 200, description: 'Período cerrado exitosamente.' })
  @ApiResponse({ status: 400, description: 'El período ya está cerrado o tiene asientos en borrador.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  @ApiResponse({ status: 404, description: 'Período no encontrado.' })
  async closePeriod(
    @Body() closePeriodDto: ClosePeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const closedPeriod = await this.periodClosingService.closePeriod(
      closePeriodDto.periodId,
      user.organizationId,
      user.id,
    );
    return {
      messageKey: 'ACCOUNTING.PERIOD_CLOSED',
      messageParams: { name: closedPeriod.name },
      period: closedPeriod,
    };
  }

  @Post('reopen-period')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_REOPEN_PERIOD)
  @ApiOperation({ summary: 'Reabre un período contable cerrado.' })
  @ApiResponse({ status: 200, description: 'Período reabierto exitosamente.'})
  @ApiResponse({ status: 400, description: 'El período no está cerrado.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes o el período siguiente ya está cerrado.'})
  @ApiResponse({ status: 404, description: 'Período no encontrado.'})
  async reopenPeriod(
    @Body() reopenPeriodDto: ReopenPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const reopenedPeriod = await this.periodClosingService.reopenPeriod(
      reopenPeriodDto,
      user.organizationId,
      user.id,
    );
    return {
      messageKey: 'ACCOUNTING.PERIOD_REOPENED',
      messageParams: { name: reopenedPeriod.name },
      period: reopenedPeriod,
    };
  }

  @Post('close-module-period')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_PERIOD)
  @ApiOperation({ summary: 'Cierra un período para un módulo específico (GL, AP, AR, Inventario).' })
  @ApiResponse({ status: 200, description: 'Módulo del período cerrado exitosamente.' })
  async closeModulePeriod(
    @Body() dto: ModulePeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const period = await this.periodClosingService.closeModulePeriod(
      dto.periodId,
      dto.module,
      user.organizationId,
      user.id,
    );
    return {
      messageKey: 'ACCOUNTING.MODULE_PERIOD_CLOSED',
      messageParams: { module: dto.module, name: period.name },
      period,
    };
  }

  @Post('reopen-module-period')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_REOPEN_PERIOD)
  @ApiOperation({ summary: 'Reabre un período para un módulo específico (GL, AP, AR, Inventario).' })
  @ApiResponse({ status: 200, description: 'Módulo del período reabierto exitosamente.' })
  async reopenModulePeriod(
    @Body() dto: ModulePeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const period = await this.periodClosingService.reopenModulePeriod(
      dto.periodId,
      dto.module,
      user.organizationId,
      user.id,
    );
    return {
      messageKey: 'ACCOUNTING.MODULE_PERIOD_REOPENED',
      messageParams: { module: dto.module, name: period.name },
      period,
    };
  }

  @Post('lock-account-in-period')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_PERIOD)
  @ApiOperation({ summary: 'Bloquea una cuenta contable específica para un período determinado.' })
  @ApiResponse({ status: 200, description: 'Cuenta bloqueada exitosamente para el período.' })
  lockAccountInPeriod(
    @Body() dto: LockAccountInPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.periodClosingService.lockAccountInPeriod(dto, user.organizationId);
  }

  @Post('unlock-account-in-period')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_REOPEN_PERIOD)
  @ApiOperation({ summary: 'Desbloquea una cuenta contable específica para un período determinado.' })
  @ApiResponse({ status: 200, description: 'Bloqueo de cuenta removido exitosamente para el período.' })
  unlockAccountInPeriod(
    @Body() dto: LockAccountInPeriodDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.periodClosingService.unlockAccountInPeriod(dto, user.organizationId);
  }
}