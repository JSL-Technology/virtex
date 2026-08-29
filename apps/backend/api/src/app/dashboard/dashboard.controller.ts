
import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { DashboardService } from './dashboard.service';
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

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpi/quick-ratio')
  getQuickRatio(@CurrentUser() user: AuthenticatedUser): Promise<QuickRatioDto> {
    return this.dashboardService.getQuickRatio(user.organizationId);
  }

  @Get('kpi/working-capital')
  getWorkingCapital(@CurrentUser() user: AuthenticatedUser): Promise<WorkingCapitalDto> {
    return this.dashboardService.getWorkingCapital(user.organizationId);
  }

  @Get('kpi/current-ratio')
  getCurrentRatio(@CurrentUser() user: AuthenticatedUser): Promise<CurrentRatioDto> {
    return this.dashboardService.getCurrentRatio(user.organizationId);
  }

  @Get('kpi/roa')
  getROA(@CurrentUser() user: AuthenticatedUser): Promise<RoadDto> {
    return this.dashboardService.getROA(user.organizationId);
  }

  @Get('kpi/roe')
  getROE(@CurrentUser() user: AuthenticatedUser): Promise<RoeDto> {
    return this.dashboardService.getROE(user.organizationId);
  }

  @Get('kpi/leverage')
  getLeverage(@CurrentUser() user: AuthenticatedUser): Promise<LeverageDto> {
    return this.dashboardService.getLeverage(user.organizationId);
  }

  @Get('kpi/net-margin')
  getNetMargin(@CurrentUser() user: AuthenticatedUser): Promise<NetMarginDto> {
    return this.dashboardService.getNetMargin(user.organizationId);
  }

  @Get('kpi/ebitda')
  getEBITDA(@CurrentUser() user: AuthenticatedUser): Promise<EbitdaDto> {
    return this.dashboardService.getEBITDA(user.organizationId);
  }

  @Get('kpi/fcf')
  getFreeCashFlow(@CurrentUser() user: AuthenticatedUser): Promise<FcfDto> {
    return this.dashboardService.getFreeCashFlow(user.organizationId);
  }

  @Get('consolidated-cash-flow-waterfall')
  @ApiOkResponse({ type: CashFlowWaterfallDto })
  getConsolidatedCashFlowWaterfall(@CurrentUser() user: AuthenticatedUser): Promise<CashFlowWaterfallDto> {
    return this.dashboardService.getConsolidatedCashFlowWaterfall(user.organizationId);
  }
}