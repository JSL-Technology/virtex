
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { RunInflationAdjustmentDto } from './dto/run-inflation-adjustment.dto';
import { InflationAdjustmentService } from './inflation-adjustment.service';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('accounting/inflation-adjustment')
@UseGuards(JwtAuthGuard)
export class InflationAdjustmentController {
  constructor(private readonly adjustmentService: InflationAdjustmentService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_RUN_INFLATION_ADJUSTMENT)
  async run(@Body() dto: RunInflationAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    await this.adjustmentService.runAdjustment(dto.year, dto.month, user.organizationId);
    return { messageKey: 'ACCOUNTING.PROCESO_AJUSTE_POR_INFLACION_EJECUTADO_EXITOSAMENTE' };
  }
}