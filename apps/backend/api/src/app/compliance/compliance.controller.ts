import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  BadRequestException,
  ParseIntPipe,
  ParseUUIDPipe,
  Res,
} from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ProvisionNcfSequenceDto } from './dto/provision-ncf-sequence.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { HttpResponse as Response } from '../common/http/http.types';

type ReportKind = '606' | '607' | '608' | '609';

/**
 * Dominican Republic fiscal compliance: NCF/e-NCF range provisioning and the DGII periodic returns.
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
      throw new BadRequestException('El número final no puede ser menor que el inicial.');
    }
    return this.complianceService.provisionNcfSequence(user.organizationId, dto);
  }

  @Get('ncf-sequences')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  listSequences(@CurrentUser() user: AuthenticatedUser) {
    return this.complianceService.listNcfSequences(user.organizationId);
  }

  /** Activate or retire a registered range without deleting its history. */
  @Patch('ncf-sequences/:id')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  setSequenceActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('isActive') isActive: boolean,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.complianceService.setSequenceActive(user.organizationId, id, Boolean(isActive));
  }

  /**
   * The four DGII "formatos de envío", on one route.
   *
   * Only the 607 and 606 were reachable before, and the 608 (voided comprobantes) did not exist at
   * all — leaving a taxpayer unable to declare an annulled fiscal number.
   */
  @Get('reports/:kind')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  async downloadReport(
    @Param('kind') kind: string,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const report = this.assertKind(kind);
    this.assertPeriod(year, month);

    const body = await this.generate(report, user.organizationId, year, month);
    const fileName = `DGII_${report}_${year}${String(month).padStart(2, '0')}.txt`;
    res
      .header('Content-Type', 'text/plain; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${fileName}"`)
      .send(body);
  }

  private generate(
    kind: ReportKind,
    organizationId: string,
    year: number,
    month: number,
  ): Promise<string> {
    switch (kind) {
      case '607':
        return this.complianceService.generate607Report(organizationId, year, month);
      case '606':
        return this.complianceService.generate606Report(organizationId, year, month);
      case '608':
        return this.complianceService.generate608Report(organizationId, year, month);
      case '609':
        return this.complianceService.generate609Report(organizationId, year, month);
    }
  }

  private assertKind(kind: string): ReportKind {
    if (kind === '606' || kind === '607' || kind === '608' || kind === '609') return kind;
    throw new BadRequestException(
      `Formato "${kind}" no reconocido. Los formatos disponibles son 606, 607, 608 y 609.`,
    );
  }

  private assertPeriod(year: number, month: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('El mes debe estar entre 1 y 12.');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('El año no es válido.');
    }
  }
}
