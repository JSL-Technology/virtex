
import {
  Controller,
  Post,
  Body,
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

@ApiTags('Accounting')
@ApiBearerAuth()
@Controller('accounting')
@UseGuards(JwtAuthGuard)
export class AccountingController {
  constructor(private readonly periodClosingService: PeriodClosingService) {}

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
    @CurrentUser() user: User,
  ) {
    const closedPeriod = await this.periodClosingService.closePeriod(
      closePeriodDto.periodId,
      user.organizationId,
    );
    return {
      message: `El período contable "${closedPeriod.name}" ha sido cerrado exitosamente.`,
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
    @CurrentUser() user: User,
  ) {
    const reopenedPeriod = await this.periodClosingService.reopenPeriod(
      reopenPeriodDto,
      user.organizationId,
      user.id,
    );
    return {
      message: `El período contable "${reopenedPeriod.name}" ha sido reabierto exitosamente.`,
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
    @CurrentUser() user: User,
  ) {
    const period = await this.periodClosingService.closeModulePeriod(
      dto.periodId,
      dto.module,
      user.organizationId,
    );
    return {
      message: `El módulo ${dto.module} para el período "${period.name}" ha sido cerrado.`,
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
    @CurrentUser() user: User,
  ) {
    const period = await this.periodClosingService.reopenModulePeriod(
      dto.periodId,
      dto.module,
      user.organizationId,
    );
    return {
      message: `El módulo ${dto.module} para el período "${period.name}" ha sido reabierto.`,
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
    @CurrentUser() user: User,
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
    @CurrentUser() user: User,
  ) {
    return this.periodClosingService.unlockAccountInPeriod(dto, user.organizationId);
  }
}