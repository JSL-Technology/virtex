import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  ParseIntPipe,
  Res,
} from '@nestjs/common';
import { GenerateReturnQueryDto, returnOptionsOf } from './dto/return-query.dto';
import { FiscalReportFilingsQueryDto, MarkFiscalReportSubmittedDto } from './dto/fiscal-report-filing.dto';
import { FilingPeriod, FiscalReportFilingsService } from './fiscal-report-filings.service';
import { ReturnsService } from './returns/returns.service';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import type { HttpResponse as Response } from '../common/http/http.types';
import { BadRequestError } from '../i18n/localized.exception';
import { AuditAccessInterceptor } from '../audit/audit-access.interceptor';
import { AuditAccess } from '../audit/audit-access.decorator';
import { ActionType } from '../audit/entities/audit-log.entity';

/**
 * The periodic fiscal returns a market's authority receives. The ranges a document is numbered from
 * are every market's, in `einvoicing/regime/ranges`.
 */
@Controller('compliance')
@UseInterceptors(AuditAccessInterceptor)
export class ComplianceController {
  constructor(
    private readonly returns: ReturnsService,
    private readonly filings: FiscalReportFilingsService,
  ) {}

  /**
   * What this company's market files, and what each filing asks for.
   *
   * The screen that offers the returns reads this: it used to carry one list of Dominican formats
   * and another of Mexican documents, so a market the product gained filed nothing until the
   * client was edited too (docs/ARQUITECTURA_MERCADOS.md, fase 5).
   */
  @Get('returns')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  availableReturns(@CurrentUser() user: AuthenticatedUser) {
    return this.returns.available(user.organizationId);
  }

  /**
   * One return of one period, as its authority receives it.
   *
   * One route for every market: which filings exist, what they are called, what they carry and
   * what they refuse is the market's (`markets/<cc>/returns.ts`). A code this market does not file
   * answers 404 rather than an empty file.
   */
  @Get('returns/:code')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  // A fiscal return is a file that leaves the product carrying every sale or purchase of a month,
  // with counterparties and tax ids. Who took a copy, and of which period, is a question a tenant
  // under audit will be asked and could not previously answer.
  @AuditAccess({ entity: 'fiscal_return', action: ActionType.EXPORT, identifiers: ['code', 'year', 'month'] })
  async downloadReturn(
    @Param('code') code: string,
    @Query() query: GenerateReturnQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const generated = await this.returns.generate(
      user.organizationId,
      code,
      { year: query.year, month: query.month, ledgerId: query.ledgerId },
      returnOptionsOf(query),
    );
    if (generated.tracked) {
      await this.filings.recordGeneration(
        { organizationId: user.organizationId, kind: generated.code, year: query.year, month: query.month },
        generated.body,
        generated.records,
        user.id,
      );
    }
    res
      .header('Content-Type', generated.mediaType)
      .header('Content-Disposition', `attachment; filename="${generated.fileName}"`)
      .send(generated.body);
  }

  // ── Filing calendar ────────────────────────────────────────────────────────

  /**
   * The year's tracked returns: which months were generated, which were filed and with what
   * acknowledgement, and which changed after filing.
   */
  @Get('filings')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  listFilings(@Query() query: FiscalReportFilingsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.filings.list(user.organizationId, query.year);
  }

  /** The first day the company has anything to report (QA A-15): the calendar starts there. */
  @Get('filings/active-since')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  async activeSince(@CurrentUser() user: AuthenticatedUser) {
    return { activeSince: await this.filings.activeSince(user.organizationId) };
  }

  /**
   * Generate the period's file without downloading it, to learn its record count and whether it
   * still matches what was filed. Recorded like a download: it is a generation.
   */
  @Post('filings/:kind/:year/:month/check')
  @HasPermission(PERMISSIONS.REPORTS_VIEW_FINANCIAL)
  async checkFiling(
    @Param('kind') kind: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const period = await this.filingPeriod(kind, year, month, user);
    const generated = await this.returns.generate(user.organizationId, kind, { year, month });
    return this.filings.recordGeneration(period, generated.body, generated.records, user.id);
  }

  /**
   * Declare the period's last generated file as filed with the authority.
   *
   * Filing a return is part of closing the month, and declaring one that was not filed hides the
   * omission from whoever closes it next — so it takes the period-close permission, not the one
   * that lets a user read the reports.
   */
  @Post('filings/:kind/:year/:month/submission')
  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_PERIOD)
  async markSubmitted(
    @Param('kind') kind: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @Body() dto: MarkFiscalReportSubmittedDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.filings.markSubmitted(await this.filingPeriod(kind, year, month, user), dto.reference, user.id);
  }

  /** Undo a filing declared by mistake. */
  @Delete('filings/:kind/:year/:month/submission')
  @HasPermission(PERMISSIONS.ACCOUNTING_CLOSE_PERIOD)
  async clearSubmission(
    @Param('kind') kind: string,
    @Param('year', ParseIntPipe) year: number,
    @Param('month', ParseIntPipe) month: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.filings.clearSubmission(await this.filingPeriod(kind, year, month, user));
  }

  /**
   * The period of a tracked filing.
   *
   * What is tracked is the market's answer, not a list in this module: a filing its authority asks
   * for on demand has no monthly deadline to show «not filed» against.
   */
  private async filingPeriod(
    kind: string,
    year: number,
    month: number,
    user: AuthenticatedUser,
  ): Promise<FilingPeriod> {
    this.assertPeriod(year, month);
    if (!(await this.returns.isTracked(user.organizationId, kind))) {
      throw new BadRequestError('compliance.fiscal_report_kind_not_tracked', { kind });
    }
    return { organizationId: user.organizationId, kind, year, month };
  }

  private assertPeriod(year: number, month: number): void {
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestError('compliance.month_must_between_12');
    }
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestError('compliance.year_not_valid');
    }
  }
}
