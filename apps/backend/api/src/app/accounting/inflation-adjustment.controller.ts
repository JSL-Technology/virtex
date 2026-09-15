
import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { RunInflationAdjustmentDto } from './dto/run-inflation-adjustment.dto';
import { InflationAdjustmentService } from './inflation-adjustment.service';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Controller('accounting/inflation-adjustment')
export class InflationAdjustmentController {
  constructor(private readonly adjustmentService: InflationAdjustmentService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.ACCOUNTING_RUN_INFLATION_ADJUSTMENT)
  async run(@Body() dto: RunInflationAdjustmentDto, @CurrentUser() user: AuthenticatedUser) {
    await this.adjustmentService.runAdjustment(dto.year, dto.month, user.organizationId, user.id);
    return { messageKey: 'accounting.inflation_adjustment_process_ran_successfully' };
  }
}