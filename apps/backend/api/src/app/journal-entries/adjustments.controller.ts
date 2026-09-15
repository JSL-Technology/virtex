
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { AdjustmentsService } from './adjustments.service';
import { CreateReclassificationEntryDto } from './dto/reclassification-entry.dto';
import { CreatePeriodEndAdjustmentDto } from './dto/period-end-adjustment.dto';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';

@Controller('journal-entries/adjustments')
@UseGuards(PeriodLockGuard)
export class AdjustmentsController {
  constructor(private readonly adjustmentsService: AdjustmentsService) {}

  @Post('reclassify')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  createReclassification(
    @Body() dto: CreateReclassificationEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adjustmentsService.createReclassification(
      dto,
      user.organizationId,
      user.id,
    );
  }

  @Post('period-end')
  @HasPermission(PERMISSIONS.JOURNAL_ENTRIES_CREATE)
  createPeriodEndAdjustment(
    @Body() dto: CreatePeriodEndAdjustmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adjustmentsService.createPeriodEndAdjustment(
      dto,
      user.organizationId,
    );
  }
}
