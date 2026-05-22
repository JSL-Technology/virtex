
import { Controller, Get, UseGuards, Post, Body, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity/user.entity';
import { GenerateReportDto } from './dto/generate-report.dto';
import { GeneralLedgerReportDto } from '../journal-entries/dto/general-ledger-report.dto';
import { JournalReportDto } from '../journal-entries/dto/journal-report.dto';
import { AgingReportDto } from './dto/aging-report.dto';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('aging')
  @ApiOperation({ summary: 'Get aging report' })
  @ApiResponse({ status: 200, description: 'Return aging report.' })
  getAgingReport(@CurrentUser() user: User, @Query() query: AgingReportDto) {

    return this.reportsService.getAgingReport(
      user.organizationId,
      query.ledgerId,
    );
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate a new financial report' })
  async generateReport(
    @CurrentUser() user: User,
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
        return this.reportsService.getAgingReport(user.organizationId);
      default:
        throw new Error('Unsupported report type');
    }
  }
}
