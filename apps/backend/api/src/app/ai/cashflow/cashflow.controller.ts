import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CheckFeature } from '../../saas/contracts/entitlements.contract';
import { currentLanguage } from '../../i18n/request-locale';
import { CashflowService } from './cashflow.service';
import { ReportsService } from '../reports/reports.service';

export class CashflowRunDto {
  /** The balance below which the company is short; 0 by default. */
  @IsNumber({}, { message: 'validation.constraints.is_number' })
  @IsOptional()
  threshold?: number;
}

export class CashflowScenarioDto extends CashflowRunDto {
  @IsNumber({}, { message: 'validation.constraints.is_number' })
  @Min(-1)
  @Max(5)
  @IsOptional()
  salesChange?: number;

  @IsNumber({}, { message: 'validation.constraints.is_number' })
  @Min(-60)
  @Max(180)
  @IsOptional()
  collectionDelayDays?: number;

  @IsNumber({}, { message: 'validation.constraints.is_number' })
  @Min(0)
  @IsOptional()
  extraMonthlyExpense?: number;

  @IsNumber({}, { message: 'validation.constraints.is_number' })
  @IsOptional()
  oneOffAmount?: number;

  @IsNumber({}, { message: 'validation.constraints.is_number' })
  @Min(0)
  @Max(365)
  @IsOptional()
  oneOffDay?: number;
}

@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/cashflow')
@HasPermission(PERMISSIONS.AI_CASHFLOW_VIEW)
@CheckFeature('ai_cashflow')
export class CashflowController {
  constructor(
    private readonly cashflow: CashflowService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'The projected cash balance (P10/P50/P90 per day), its headline figures and drivers.' })
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.cashflow.overview(user.organizationId);
  }

  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: "Project again from today's cash." })
  refresh(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashflowRunDto) {
    return this.cashflow.refresh(user.organizationId, user.id, 'MANUAL', dto.threshold ?? 0);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Open invoices or bills in the projection, with when their money is likely to move.' })
  documents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind: string,
    @Query('sort') sort?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ) {
    return this.cashflow.documents(user.organizationId, {
      kind: kind === 'PAYABLE' ? 'PAYABLE' : 'RECEIVABLE',
      sort: (['amount', 'risk', 'expected'] as const).find((value) => value === sort) ?? 'amount',
      limit,
      offset,
    });
  }

  @Post('scenarios')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Simulate a what-if beside the projection.' })
  scenario(@CurrentUser() user: AuthenticatedUser, @Body() dto: CashflowScenarioDto) {
    const { threshold, ...scenario } = dto;
    return this.cashflow.scenario(user.organizationId, user.id, scenario, threshold ?? 0);
  }

  @Get('scenarios')
  scenarios(@CurrentUser() user: AuthenticatedUser) {
    return this.cashflow.scenarios(user.organizationId);
  }

  @Get('scenarios/:id')
  scenarioResult(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.cashflow.scenarioResult(user.organizationId, id);
  }

  @Post('plan')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Have the cash plan written from the projection (in the background).' })
  requestPlan(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.request(user.organizationId, user.id, 'CASHFLOW_PLAN', { language: currentLanguage() });
  }

  @Get('plan')
  @ApiOperation({ summary: 'The latest cash plan, or the one being written.' })
  latestPlan(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.latest(user.organizationId, 'CASHFLOW_PLAN');
  }
}

