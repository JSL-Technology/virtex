
import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { FinancialReportingService, DimensionFilters } from './financial-reporting.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PERMISSIONS } from '../shared/permissions';
import { HasPermission } from '../auth/decorators/permissions.decorator';

@ApiTags('Financial Reporting')
@ApiBearerAuth()
@Controller('financial-reporting')
@UseGuards(JwtAuthGuard)
export class FinancialReportingController {
  constructor(
    private readonly financialReportingService: FinancialReportingService,
  ) {}

  @Get('balance-sheet')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @ApiOperation({ summary: 'Genera el Balance General (Estado de Situación Financiera).' })
  @ApiResponse({ status: 200, description: 'Balance General generado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Parámetros de solicitud inválidos.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  @ApiQuery({ name: 'asOfDate', required: false, type: String, description: 'Fecha de corte para el reporte (formato YYYY-MM-DD). Por defecto, es la fecha actual.' })
  @ApiQuery({ name: 'ledgerId', required: false, type: String, description: 'ID del libro contable a utilizar. Por defecto, se usa el libro principal.' })
  @ApiQuery({ name: 'costCenterId', required: false, type: String, description: 'Filtrar por ID de la dimensión Centro de Costo.' })
  @ApiQuery({ name: 'projectId', required: false, type: String, description: 'Filtrar por ID de la dimensión Proyecto.' })
  getBalanceSheet(
    @CurrentUser() user: User,
    @Query('asOfDate') asOfDate: string,
    @Query('ledgerId') ledgerId?: string,
    @Query('costCenterId') costCenterId?: string,
    @Query('projectId') projectId?: string,
  ) {
    const date = asOfDate ? new Date(asOfDate) : new Date();
    
    const filters: DimensionFilters = {};
    if (costCenterId) filters['costCenterId'] = costCenterId;
    if (projectId) filters['projectId'] = projectId;

    return this.financialReportingService.getBalanceSheet(
      user.organizationId,
      date,
      filters,
      ledgerId,
    );
  }

  @Get('income-statement')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @ApiOperation({ summary: 'Genera el Estado de Resultados (Estado de Ganancias y Pérdidas).' })
  @ApiResponse({ status: 200, description: 'Estado de Resultados generado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Parámetros de solicitud inválidos.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Fecha de inicio del período (formato YYYY-MM-DD). Por defecto, es el inicio del año actual.' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Fecha de fin del período (formato YYYY-MM-DD). Por defecto, es la fecha actual.' })
  @ApiQuery({ name: 'ledgerId', required: false, type: String, description: 'ID del libro contable a utilizar. Por defecto, se usa el libro principal.' })
  @ApiQuery({ name: 'costCenterId', required: false, type: String, description: 'Filtrar por ID de la dimensión Centro de Costo.' })
  @ApiQuery({ name: 'projectId', required: false, type: String, description: 'Filtrar por ID de la dimensión Proyecto.' })
  getIncomeStatement(
    @CurrentUser() user: User,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
    @Query('ledgerId') ledgerId?: string,
    @Query('costCenterId') costCenterId?: string,
    @Query('projectId') projectId?: string,
  ) {
    const startDate = startDateStr
      ? new Date(startDateStr)
      : new Date(new Date().getFullYear(), 0, 1);
    const endDate = endDateStr ? new Date(endDateStr) : new Date();

    const filters: DimensionFilters = {};
    if (costCenterId) filters['costCenterId'] = costCenterId;
    if (projectId) filters['projectId'] = projectId;

    return this.financialReportingService.getIncomeStatement(
      user.organizationId,
      startDate,
      endDate,
      filters,
      ledgerId,
    );
  }

  @Get('cash-flow-statement')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @ApiOperation({ summary: 'Genera el Estado de Flujo de Efectivo.' })
  @ApiResponse({ status: 200, description: 'Estado de Flujo de Efectivo generado exitosamente.' })
  @ApiResponse({ status: 400, description: 'Parámetros de solicitud inválidos.' })
  @ApiResponse({ status: 403, description: 'Permisos insuficientes.' })
  @ApiQuery({ name: 'startDate', required: false, type: String, description: 'Fecha de inicio del período (formato YYYY-MM-DD). Por defecto, es el inicio del año actual.' })
  @ApiQuery({ name: 'endDate', required: false, type: String, description: 'Fecha de fin del período (formato YYYY-MM-DD). Por defecto, es la fecha actual.' })
  @ApiQuery({ name: 'ledgerId', required: false, type: String, description: 'ID del libro contable a utilizar. Por defecto, se usa el libro principal.' })
  getCashFlowStatement(
    @CurrentUser() user: User,
    @Query('startDate') startDateStr: string,
    @Query('endDate') endDateStr: string,
    @Query('ledgerId') ledgerId?: string,
  ) {
    const startDate = startDateStr
      ? new Date(startDateStr)
      : new Date(new Date().getFullYear(), 0, 1);
    const endDate = endDateStr ? new Date(endDateStr) : new Date();
    return this.financialReportingService.getCashFlowStatement(
      user.organizationId,
      startDate,
      endDate,
      ledgerId,
    );
  }
}