import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, UseInterceptors, ParseIntPipe, ParseUUIDPipe, Res } from '@nestjs/common';
import { ComplianceService } from './compliance.service';
import { ProvisionNcfSequenceDto } from './dto/provision-ncf-sequence.dto';
import { MexicanAccountingQueryDto } from './dto/mexican-accounting-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { HttpResponse as Response } from '../common/http/http.types';
import { BadRequestError } from '../i18n/localized.exception';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { AuditAccess } from '../audit/audit-access.decorator';
import { ActionType } from '../audit/entities/audit-log.entity';

type ReportKind = '606' | '607' | '608' | '609';

/**
 * Dominican Republic fiscal compliance: NCF/e-NCF range provisioning and the DGII periodic returns.
 */
@Controller('compliance')
@UseGuards(JwtAuthGuard)
@UseInterceptors(AuditAccessInterceptor)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Post('ncf-sequences')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  provisionSequence(
    @Body() dto: ProvisionNcfSequenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (dto.endsAt < dto.startsAt) {
      throw new BadRequestError('COMPLIANCE.NUMERO_FINAL_NO_PUEDE_SER_MENOR_INICIAL');
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
  // A fiscal return is a file that leaves the product carrying every sale or purchase of a month,
  // with counterparties and tax ids. Who took a copy, and of which period, is a question a tenant
  // under audit will be asked and could not previously answer.
  @AuditAccess({ entity: 'dgii_report', action: ActionType.EXPORT, identifiers: ['kind', 'year', 'month'] })
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

  /**
   * Mexico's electronic accounting: `catalogo`, `balanza` or `polizas`, as XML.
   *
   * A separate route from the Dominican `reports/:kind` because these are XML documents with their
   * own parameters — a complementary Balanza carries the date it corrects, a Pólizas file carries
   * the audit or refund number it answers — and folding four query strings into one route to
   * share a path segment would make both harder to read.
   *
   * The files are unsigned: sealing them with the taxpayer's FIEL and filing them through the
   * Buzón Tributario is the accountant's step. Saying so here is better than a file this product
   * claimed to have sealed and had not.
   */
  @Get('mx/electronic-accounting/:document')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  @AuditAccess({
    entity: 'mx_electronic_accounting',
    action: ActionType.EXPORT,
    identifiers: ['document', 'year', 'month'],
  })
  async downloadMexicanAccounting(
    @Param('document') document: string,
    @Query() query: MexicanAccountingQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const period = {
      organizationId: user.organizationId,
      year: query.year,
      month: query.month,
    };
    this.assertPeriod(query.year, query.month);

    const xml = await this.generateMexican(document, period, query);
    const stamp = `${query.year}${String(query.month).padStart(2, '0')}`;
    res
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="SAT_${document}_${stamp}.xml"`)
      .send(xml);
  }

  private generateMexican(
    document: string,
    period: { organizationId: string; year: number; month: number },
    query: MexicanAccountingQueryDto,
  ): Promise<string> {
    switch (document) {
      case 'catalogo':
        return this.complianceService.generateMexicanCatalogo(period);
      case 'balanza':
        return this.complianceService.generateMexicanBalanza(period, {
          tipoEnvio: query.tipoEnvio,
          fechaModBal: query.fechaModBal,
        });
      case 'polizas':
        return this.complianceService.generateMexicanPolizas(period, {
          tipoSolicitud: query.tipoSolicitud,
          numOrden: query.numOrden,
          numTramite: query.numTramite,
        });
      default:
        throw new BadRequestError('COMPLIANCE.DOCUMENTO_CONTABILIDAD_ELECTRONICA_NO_VALIDO', {
          document,
          available: 'catalogo, balanza, polizas',
        });
    }
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
    throw new BadRequestError('COMPLIANCE.FORMATO_NO_RECONOCIDO_FORMATOS_DISPONIBLES_SON_606', { kind });
  }

  private assertPeriod(year: number, month: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestError('COMPLIANCE.MES_DEBE_ESTAR_ENTRE_12');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestError('COMPLIANCE.ANO_NO_ES_VALIDO');
    }
  }
}
