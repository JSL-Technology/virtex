
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AdjustmentsService } from './adjustments.service';
import { CreateReclassificationEntryDto } from './dto/reclassification-entry.dto';
import { CreatePeriodEndAdjustmentDto } from './dto/period-end-adjustment.dto';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('journal-entries/adjustments')
@UseGuards(JwtAuthGuard, PeriodLockGuard)
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Post('reclassify')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  createReclassification(
    @Body() dto: CreateReclassificationEntryDto,
    @CurrentUser() user: User,
  ) {
    return this.adjustmentsService.createReclassification(
      dto,
      user.organizationId,
    );
  }

  @Post('period-end')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  createPeriodEndAdjustment(
    @Body() dto: CreatePeriodEndAdjustmentDto,
    @CurrentUser() user: User,
  ) {
    return this.adjustmentsService.createPeriodEndAdjustment(
      dto,
      user.organizationId,
    );
  }
}
