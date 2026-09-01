import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { InvoicesService, InvoiceListQuery } from './invoices.service';
import { InvoiceRendererService } from './services/invoice-renderer.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { HttpResponse as Response } from '../common/http/http.types';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CheckPlanLimit } from '../saas/decorators/plan-limit.decorator';
import { PlanLimitCheckGuard } from '../saas/guards/plan-limit-check.guard';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { InvoiceStatus } from './entities/invoice.entity';

/**
 * Sales documents.
 *
 * Every route declares the permission it needs. Only `POST /invoices` used to: listing, reading,
 * downloading the PDF and — most seriously — issuing a credit note answered any authenticated
 * member of the tenant. `invoices:void` was defined in `shared/permissions.ts`, granted to roles,
 * and enforced nowhere, so a role explicitly denied the right to annul a fiscal document could
 * annul one. The credit-note route also bypassed `PeriodLockGuard`, letting a closed accounting
 * period be modified.
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly renderer: InvoiceRendererService,
  ) {}

  @Post()
  @UseGuards(PeriodLockGuard, PlanLimitCheckGuard)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  @CheckPlanLimit(SaasResource.INVOICES, 1)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.create(dto, user.organizationId);
  }

  /** Issue a draft: assigns the fiscal number, posts the ledger entry and transmits the e-CF. */
  @Post(':id/issue')
  @UseGuards(PeriodLockGuard, PlanLimitCheckGuard)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  @CheckPlanLimit(SaasResource.INVOICES, 1)
  @HttpCode(HttpStatus.OK)
  issue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: IssueInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.issue(id, user.organizationId, dto.fiscalDocumentType);
  }

  /** Replace a draft's contents. An issued document is immutable; correct it with a credit note. */
  @Put(':id')
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.INVOICES_EDIT)
  updateDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.updateDraft(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.INVOICES_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.invoicesService.discardDraft(id, user.organizationId);
  }

  @Get()
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  findAll(@Query() query: InvoiceListQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findAll(user.organizationId, {
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      status: query.status as InvoiceStatus | undefined,
      customerId: query.customerId,
      from: query.from,
      to: query.to,
      search: query.search,
    });
  }

  /**
   * What the invoicing screen needs before showing a form: readiness, the tenant's currency, the
   * rates its market levies and the fiscal document types it may issue.
   */
  @Get('context')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  context(@CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.invoicingContext(user.organizationId);
  }

  @Get(':id')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findOne(id, user.organizationId);
  }

  @Post(':id/credit-note')
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.INVOICES_VOID)
  @HttpCode(HttpStatus.CREATED)
  createCreditNote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCreditNoteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.createCreditNote(
      { ...dto, invoiceId: id },
      user.organizationId,
    );
  }

  @Get(':id/pdf')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async downloadPdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { invoice, context } = await this.invoicesService.renderContext(id, user.organizationId);
    const pdf = await this.renderer.renderPdf(context);

    // `res.setHeader` is Express; the application boots on Fastify, whose API is `header()`. The
    // route compiled cleanly because it typed its response as `express.Response` and threw
    // `res.setHeader is not a function` on every call in production.
    res
      .header('Content-Type', 'application/pdf')
      .header(
        'Content-Disposition',
        `attachment; filename="${invoice.ncfNumber ?? invoice.invoiceNumber}.pdf"`,
      )
      .header('Content-Length', String(pdf.length))
      .send(pdf);
  }

  /** The same representation as HTML, for on-screen printing without a round trip to Chromium. */
  @Get(':id/print')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async printable(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { context } = await this.invoicesService.renderContext(id, user.organizationId);
    const html = await this.renderer.renderHtml(context);
    res.header('Content-Type', 'text/html; charset=utf-8').send(html);
  }
}
