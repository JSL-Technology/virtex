
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { ConsolidationService } from './consolidation.service';
import { RunConsolidationDto } from './dto/run-consolidation.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
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
@UseGuards(JwtAuthGuard)
@CheckFeature('group_consolidation')
export class ConsolidationController {
  constructor(private readonly consolidationService: ConsolidationService) {}

  @Post('run')
  @HasPermission(PERMISSIONS.FINANCIALS_CONSOLIDATE)
  runConsolidation(
    @Body() runDto: RunConsolidationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const asOfDate = new Date(runDto.asOfDate);
    return this.consolidationService.runConsolidation(user.organizationId, asOfDate);
  }
}