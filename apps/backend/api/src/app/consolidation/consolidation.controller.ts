
import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ConsolidationService } from './consolidation.service';
import { RunConsolidationDto } from './dto/run-consolidation.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { CheckFeature } from '../saas/guards/feature-flag.guard';

/**
 * Group consolidation is a plan capability, not just a permission.
 *
 * The plan catalogue already says so: Starter carries a `SUBSIDIARIES` limit of 0. Without the
 * capability check the tenant was blocked from CREATING a subsidiary but could still reach the
 * consolidation run, which reports on a group they cannot have — a worse answer than saying the
 * plan does not include it.
 */
@Controller('consolidation')
@CheckFeature('group_consolidation')
export class ConsolidationController {
  constructor(private readonly consolidationService: ConsolidationService) {}

  @Post('run')
  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  runConsolidation(
    @Body() runDto: RunConsolidationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.consolidationService.runAndRecord(user.organizationId, runDto.asOfDate, runDto.startDate, user.id);
  }

  /** The runs kept for the group, newest first: the history of its consolidated figures. */
  @Get('runs')
  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  listRuns(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    return this.consolidationService.listRuns(user.organizationId, Math.min(100, Math.max(1, Number(limit) || 25)));
  }

  /** One run, with the statements as they were computed. */
  @Get('runs/:id')
  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  getRun(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.consolidationService.getRun(user.organizationId, id);
  }
}