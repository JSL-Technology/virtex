
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { DashboardService } from './dashboard.service';
import { DashboardChartsService } from './dashboard-charts.service';
import { ChartWindowDto } from './dto/chart-window.dto';
import { QuickRatioDto } from './dto/quick-ratio.dto';
import { WorkingCapitalDto } from './dto/working-capital.dto';
import { CurrentRatioDto } from './dto/current-ratio.dto';
import { RoadDto } from './dto/roa.dto';
import { RoeDto } from './dto/roe.dto';
import { LeverageDto } from './dto/leverage.dto';
import { NetMarginDto } from './dto/net-margin.dto';
import { EbitdaDto } from './dto/ebitda.dto';
import { FcfDto } from './dto/fcf.dto';
import { CashFlowWaterfallDto } from './dto/cash-flow-waterfall.dto';
import { ApiOkResponse } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    /**
     * The series behind the charts. Every one of them used to be a literal in the browser bundle —
     * the same seven months of sales for every customer of the product.
     */
    private readonly charts: DashboardChartsService,
  ) {}

  @Get('summary')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  summary(@CurrentUser() user: AuthenticatedUser) {
    return this.charts.summary(user.organizationId);
  }

  @Get('sales-trend')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  salesTrend(@CurrentUser() user: AuthenticatedUser, @Query() query: ChartWindowDto) {
    return this.charts.salesTrend(user.organizationId, query.months ?? 12);
  }

  @Get('expense-breakdown')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  expenseBreakdown(@CurrentUser() user: AuthenticatedUser, @Query() query: ChartWindowDto) {
    return this.charts.expenseBreakdown(user.organizationId, query.months ?? 12, query.limit ?? 8);
  }

  @Get('budget-vs-actual')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  budgetVsActual(@CurrentUser() user: AuthenticatedUser, @Query() query: ChartWindowDto) {
    return this.charts.budgetVsActual(user.organizationId, query.months ?? 12);
  }

  @Get('invoice-status')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  invoiceStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.charts.invoiceStatusMix(user.organizationId);
  }

  @Get('top-products')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  topProducts(@CurrentUser() user: AuthenticatedUser, @Query() query: ChartWindowDto) {
    return this.charts.topProducts(user.organizationId, query.months ?? 12, query.limit ?? 5);
  }

  @Get('low-stock')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  lowStock(@CurrentUser() user: AuthenticatedUser, @Query() query: ChartWindowDto) {
    return this.charts.lowStock(user.organizationId, query.limit ?? 10);
  }

  @Get('alerts')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  alerts(@CurrentUser() user: AuthenticatedUser) {
    return this.charts.alerts(user.organizationId);
  }

  @Get('kpi/quick-ratio')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getQuickRatio(@CurrentUser() user: AuthenticatedUser): Promise<QuickRatioDto> {
    return this.dashboardService.getQuickRatio(user.organizationId);
  }

  @Get('kpi/working-capital')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getWorkingCapital(@CurrentUser() user: AuthenticatedUser): Promise<WorkingCapitalDto> {
    return this.dashboardService.getWorkingCapital(user.organizationId);
  }

  @Get('kpi/current-ratio')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getCurrentRatio(@CurrentUser() user: AuthenticatedUser): Promise<CurrentRatioDto> {
    return this.dashboardService.getCurrentRatio(user.organizationId);
  }

  @Get('kpi/roa')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getROA(@CurrentUser() user: AuthenticatedUser): Promise<RoadDto> {
    return this.dashboardService.getROA(user.organizationId);
  }

  @Get('kpi/roe')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getROE(@CurrentUser() user: AuthenticatedUser): Promise<RoeDto> {
    return this.dashboardService.getROE(user.organizationId);
  }

  @Get('kpi/leverage')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getLeverage(@CurrentUser() user: AuthenticatedUser): Promise<LeverageDto> {
    return this.dashboardService.getLeverage(user.organizationId);
  }

  @Get('kpi/net-margin')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getNetMargin(@CurrentUser() user: AuthenticatedUser): Promise<NetMarginDto> {
    return this.dashboardService.getNetMargin(user.organizationId);
  }

  @Get('kpi/ebitda')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getEBITDA(@CurrentUser() user: AuthenticatedUser): Promise<EbitdaDto> {
    return this.dashboardService.getEBITDA(user.organizationId);
  }

  @Get('kpi/fcf')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  getFreeCashFlow(@CurrentUser() user: AuthenticatedUser): Promise<FcfDto> {
    return this.dashboardService.getFreeCashFlow(user.organizationId);
  }

  @Get('consolidated-cash-flow-waterfall')
  @HasPermission(PERMISSIONS.DASHBOARD_VIEW)
  @ApiOkResponse({ type: CashFlowWaterfallDto })
  getConsolidatedCashFlowWaterfall(@CurrentUser() user: AuthenticatedUser): Promise<CashFlowWaterfallDto> {
    return this.dashboardService.getConsolidatedCashFlowWaterfall(user.organizationId);
  }
}