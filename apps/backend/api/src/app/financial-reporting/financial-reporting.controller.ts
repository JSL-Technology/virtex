
import { Controller, Get, UseGuards, UseInterceptors, Query } from '@nestjs/common';
import { FinancialReportingService, DimensionFilters } from './financial-reporting.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PERMISSIONS } from '../shared/permissions';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { FiscalCalendarService } from '../shared/fiscal-calendar.service';
import {
  BalanceSheetQueryDto,
  DimensionalPeriodQueryDto,
  PeriodQueryDto,
} from './dto/financial-report-query.dto';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { AuditAccess } from '../audit/audit-access.decorator';
import { ActionType } from '../audit/entities/audit-log.entity';

/**
 * The four statements.
 *
 * Every default here is resolved from the **tenant's** calendar, not the server's. The routes used
 * to build their own with `new Date()` and `new Date(new Date().getFullYear(), 0, 1)`; see
 * `FiscalCalendarService` for what that cost.
 */
@ApiTags('Financial Reporting')
@ApiBearerAuth()
@Controller('financial-reporting')
@UseGuards(JwtAuthGuard)
// Reading a financial statement is an auditable event. There was no audit of access to financial
// data at all — only of changes to it — which in a product sold to tenants under external audit
// leaves half the control missing.
@UseInterceptors(AuditAccessInterceptor)
export class FinancialReportingController {
  constructor(
    private readonly financialReportingService: FinancialReportingService,
    private readonly calendar: FiscalCalendarService,
  ) {}

  @Get('balance-sheet')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @AuditAccess({ entity: 'balance_sheet', action: ActionType.READ, identifiers: ['asOfDate', 'ledgerId'] })
  @ApiOperation({ summary: 'Genera el Balance General (Estado de Situación Financiera).' })
  @ApiResponse({ status: 200, description: 'Balance General generado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Parámetros de solicitud inválidos.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  async getBalanceSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: BalanceSheetQueryDto,
  ) {
    const asOfDate = query.asOfDate ?? (await this.calendar.today(user.organizationId));

    return this.financialReportingService.getBalanceSheet(
      user.organizationId,
      asOfDate,
      this.dimensionsOf(query),
      query.ledgerId,
    );
  }

  @Get('income-statement')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @AuditAccess({ entity: 'income_statement', action: ActionType.READ, identifiers: ['startDate', 'endDate', 'ledgerId'] })
  @ApiOperation({ summary: 'Genera el Estado de Resultados (Estado de Ganancias y Pérdidas).' })
  @ApiResponse({ status: 200, description: 'Estado de Resultados generado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Parámetros de solicitud inválidos.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  async getIncomeStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DimensionalPeriodQueryDto,
  ) {
    const period = await this.calendar.resolvePeriod(user.organizationId, query);

    return this.financialReportingService.getIncomeStatement(
      user.organizationId,
      period.startDate,
      period.endDate,
      this.dimensionsOf(query),
      query.ledgerId,
    );
  }

  /**
   * The balanza de comprobación.
   *
   * `getTrialBalance` existed on the service and had no route, so the one report an accountant
   * opens before anything else — opening balance, movement and closing balance per account, with
   * the debit and credit columns that must agree — could not be reached at all.
   */
  @Get('trial-balance')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @AuditAccess({ entity: 'trial_balance', action: ActionType.READ, identifiers: ['startDate', 'endDate', 'ledgerId'] })
  @ApiOperation({ summary: 'Genera la balanza de comprobación.' })
  async getTrialBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PeriodQueryDto,
  ) {
    const period = await this.calendar.resolvePeriod(user.organizationId, query);

    return this.financialReportingService.getTrialBalance(
      user.organizationId,
      period.startDate,
      period.endDate,
      query.ledgerId,
    );
  }

  @Get('cash-flow-statement')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @AuditAccess({ entity: 'cash_flow_statement', action: ActionType.READ, identifiers: ['startDate', 'endDate', 'ledgerId'] })
  @ApiOperation({ summary: 'Genera el Estado de Flujo de Efectivo.' })
  @ApiResponse({ status: 200, description: 'Estado de Flujo de Efectivo generado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Parámetros de solicitud inválidos.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  async getCashFlowStatement(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PeriodQueryDto,
  ) {
    const period = await this.calendar.resolvePeriod(user.organizationId, query);

    return this.financialReportingService.getCashFlowStatement(
      user.organizationId,
      period.startDate,
      period.endDate,
      query.ledgerId,
    );
  }

  /** Only the dimensions the caller actually named; an absent filter is not a filter on `undefined`. */
  private dimensionsOf(query: { costCenterId?: string; projectId?: string }): DimensionFilters {
    const filters: DimensionFilters = {};
    if (query.costCenterId) filters['costCenterId'] = query.costCenterId;
    if (query.projectId) filters['projectId'] = query.projectId;
    return filters;
  }
}
