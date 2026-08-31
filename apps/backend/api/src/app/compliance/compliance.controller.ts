import { Controller, Get, Post, Body, Query, UseGuards, ParseIntPipe, Res } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ProvisionNcfSequenceDto } from './dto/provision-ncf-sequence.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { HttpResponse as Response } from '../common/http/http.types';
import { BadRequestError } from '../i18n/localized.exception';

/**
 * Dominican Republic fiscal compliance: NCF/e-NCF range provisioning and the DGII 606/607 reports.
 * These were previously unreachable — the module exposed no controller — so a tenant could neither
 * register its authorized ranges nor download its formats de envío.
 */
@Controller('compliance')
@UseGuards(JwtAuthGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('ncf-sequences')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  provisionSequence(
    @Body() dto: ProvisionNcfSequenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (dto.endsAt < dto.startsAt) {
      throw new BadRequestError('COMPLIANCE.ENDSAT_NO_PUEDE_SER_MENOR_STARTSAT');
    }
    return this.complianceService.provisionNcfSequence(user.organizationId, dto);
  }

  @Get('ncf-sequences')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  listSequences(@CurrentUser() user: AuthenticatedUser) {
    return this.complianceService.listNcfSequences(user.organizationId);
  }

  @Get('reports/607')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  async download607(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    this.assertPeriod(year, month);
    const body = await this.complianceService.generate607Report(user.organizationId, year, month);
    this.sendTextReport(res, `DGII_607_${year}${String(month).padStart(2, '0')}.txt`, body);
  }

  @Get('reports/606')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  async download606(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    this.assertPeriod(year, month);
    const body = await this.complianceService.generate606Report(user.organizationId, year, month);
    this.sendTextReport(res, `DGII_606_${year}${String(month).padStart(2, '0')}.txt`, body);
  }

  private assertPeriod(year: number, month: number): void {
    if (month < 1 || month > 12) {
      throw new BadRequestError('COMPLIANCE.MES_DEBE_ESTAR_ENTRE_12');
    }
    if (year < 2000 || year > 2100) {
      throw new BadRequestError('COMPLIANCE.ANO_NO_ES_VALIDO');
    }
  }

  private sendTextReport(res: Response, fileName: string, body: string): void {
    res
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(body);
  }
}
