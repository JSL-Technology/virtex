import { Controller, Get, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CheckFeature } from '../../saas/contracts/entitlements.contract';
import { currentLanguage } from '../../i18n/request-locale';
import { AI_RATE_LIMIT, TenantRateLimit, TenantRateLimitGuard } from '../../shared/rate-limit/tenant-rate-limit.guard';
import { ReportsService } from '../reports/reports.service';
import { CloseAssistantService } from './close-assistant.service';

/** The period close, as a plan: what is left, in order, and — asked for — written out by the AI. */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/close-assistant')
@HasPermission(PERMISSIONS.ACCOUNTING_VIEW)
export class CloseAssistantController {
  constructor(
    private readonly assistant: CloseAssistantService,
    private readonly reports: ReportsService,
  ) {}

  @Get(':periodId')
  @ApiOperation({ summary: 'The period\'s close checklist in the order to work through it, with what else deserves a look.' })
  view(@CurrentUser() user: AuthenticatedUser, @Param('periodId', UuidParamPipe) periodId: string) {
    return this.assistant.view(user.organizationId, periodId, currentLanguage());
  }

  @TenantRateLimit(AI_RATE_LIMIT)
  @UseGuards(TenantRateLimitGuard)
  @Post(':periodId/plan')
  @HasPermission(PERMISSIONS.AI_REPORTS_VIEW)
  @CheckFeature('ai_assistant')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Have the close plan written (in the background).' })
  async requestPlan(@CurrentUser() user: AuthenticatedUser, @Param('periodId', UuidParamPipe) periodId: string) {
    // Checked now, so a period that is not this company's is refused here rather than in the job.
    await this.assistant.view(user.organizationId, periodId, currentLanguage());
    return this.reports.request(user.organizationId, user.id, 'CLOSE_ASSISTANT', { language: currentLanguage(), sourceRunId: periodId });
  }

  @Get(':periodId/plan')
  @HasPermission(PERMISSIONS.AI_REPORTS_VIEW)
  @ApiOperation({ summary: 'The latest close plan written for the period, or the one being written.' })
  async plan(@CurrentUser() user: AuthenticatedUser, @Param('periodId', UuidParamPipe) periodId: string) {
    return this.reports.latestForRun(user.organizationId, 'CLOSE_ASSISTANT', periodId, await this.reports.reader(user.organizationId, user));
  }
}
