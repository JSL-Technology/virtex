
import { Controller, Get, UseGuards, Post, Body, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { GenerateReportDto } from './dto/generate-report.dto';
import { BadRequestError } from '../i18n/localized.exception';
import { GeneralLedgerReportDto } from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { AgingReportDto } from './dto/aging-report.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';

/**
 * The report surface.
 *
 * Every route here served the tenant's complete general ledger and complete daybook to any
 * authenticated user, because the controller declared no permission at all. The ageing report is
 * the receivables position, which is not a general-audience document either.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('aging')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @ApiOperation({ summary: 'Get aging report' })
  @ApiResponse({ status: 200, description: 'Return aging report.' })
  getAgingReport(@CurrentUser() user: AuthenticatedUser, @Query() query: AgingReportDto) {

    return this.reportsService.getAgingReport(
      user.organizationId,
      query.ledgerId,
    );
  }

  @Post('generate')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @ApiOperation({ summary: 'Generate a new financial report' })
  async generateReport(
    @CurrentUser() user: AuthenticatedUser,
    @Body() generateReportDto: GenerateReportDto,
  ) {
    switch (generateReportDto.reportType) {
      case 'general-ledger':
        return this.reportsService.generateGeneralLedgerReport(
          user.organizationId,
          generateReportDto.options as GeneralLedgerReportDto,
        );
      case 'journal':
        return this.reportsService.generateJournalReport(
          user.organizationId,
          generateReportDto.options as JournalReportDto,
        );
      case 'aging-report':
        return this.reportsService.getAgingReport(
          user.organizationId,
          (generateReportDto.options as AgingReportDto).ledgerId,
        );
      default:
        // A localized 400, not a bare `Error` — which the exception filter reports as a 500 and an
        // untranslated English sentence.
        throw new BadRequestError('REPORTS.TIPO_REPORTE_NO_SOPORTADO', {
          reportType: generateReportDto.reportType,
        });
    }
  }
}
