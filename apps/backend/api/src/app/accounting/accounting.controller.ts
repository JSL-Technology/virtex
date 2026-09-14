
import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
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
import { ListFiscalYearsQueryDto } from './dto/list-fiscal-years-query.dto';

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
   * The tenant's fiscal years.
   *
   * Nothing could read them: one route closes a year and another reopens one, and no route listed
   * them. The annual-close screen could not name the year it was about, and an audit adjustment —
   * which is proposed against a CLOSED year — had no way to offer one to choose.
   */
  @Get('fiscal-years')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'Lista los años fiscales de la organización.' })
  @ApiResponse({ status: 200, description: 'Años fiscales de la organización.' })
  listFiscalYears(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFiscalYearsQueryDto,
  ) {
    return this.periodClosingService.listFiscalYears(user.organizationId, {
      status: query.status,
    });
  }

  /**
   * The state of the world, for the status bar.
   *
   * Which accounting period today falls in and whether it is open. It is its own endpoint rather
   * than a filter over `GET /periods` because every screen asks for it: downloading a year of
   * periods to find one is the kind of cost that is invisible per screen and obvious in aggregate.
   *
   * The most common frustration in an ERP is attempting work the system is going to reject with a
   * fact it already knew. Someone who can see "period 2026-08 closed" does not try to post into
   * August.
   */
  @Get('current-period')
  @HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
  @ApiOperation({ summary: 'El período contable en el que cae hoy, y si está abierto.' })
  async currentPeriod(@CurrentUser() user: AuthenticatedUser) {
    const period = await this.periodClosingService.currentPeriod(user.organizationId);
    if (!period) return { period: null };
    return {
      period: {
        id: period.id,
        startDate: period.startDate,
        endDate: period.endDate,
        status: period.status,
      },
    };
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
    @Param('periodId', UuidParamPipe) periodId: string,
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
      messageKey: 'accounting.period_closed',
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
      messageKey: 'accounting.period_reopened',
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
      messageKey: 'accounting.module_period_closed',
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
      messageKey: 'accounting.module_period_reopened',
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