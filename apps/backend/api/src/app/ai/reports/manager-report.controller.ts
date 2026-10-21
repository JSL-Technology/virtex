import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsOptional, Matches } from 'class-validator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CheckFeature } from '../../saas/contracts/entitlements.contract';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';
import { currentLanguage } from '../../i18n/request-locale';
import { ReportsService } from './reports.service';
import { previousMonth } from './manager-report.builder';

export class ManagerReportRequestDto {
  /** `YYYY-MM`; the month that just ended when left out. */
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'validation.constraints.matches' })
  period?: string;
}

/**
 * Analysis › Manager's report: the month in a few paragraphs, written from the figures the system
 * computed. Generated on the 1st for the month that ended, and on request for any closed month.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/reports/manager')
@HasPermission(PERMISSIONS.AI_REPORTS_VIEW)
@CheckFeature('ai_manager_reports')
export class ManagerReportController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Recent monthly reports, newest first (without their content).' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query('limit') limit?: string) {
    const reader = await this.reports.reader(user.organizationId, user);
    const rows = await this.reports.list(user.organizationId, 'MANAGER_MONTHLY', reader, Math.min(Math.max(Number(limit) || 12, 1), 36));
    return rows.map(({ id, period, status, createdAt, finishedAt, error, language, audience }) => ({
      id,
      period,
      status,
      createdAt,
      finishedAt,
      error,
      language,
      audience,
    }));
  }

  /** One report — only if the reader holds every permission its facts were read under (`canReadReport`). */
  @Get(':id')
  async get(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const report = await this.reports.get(user.organizationId, id, await this.reports.reader(user.organizationId, user));
    if (report.kind !== 'MANAGER_MONTHLY') throw new NotFoundError('ai.reports.not_found');
    return report;
  }

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @ApiOperation({ summary: 'Have the report for a closed month written (in the background).' })
  request(@CurrentUser() user: AuthenticatedUser, @Body() dto: ManagerReportRequestDto) {
    const period = dto.period ?? previousMonth();
    // A month still running has no result to report yet.
    if (period > previousMonth()) throw new BadRequestError('ai.reports.period_not_closed');
    return this.reports.request(user.organizationId, user.id, 'MANAGER_MONTHLY', { period, language: currentLanguage() ?? 'es' });
  }
}
