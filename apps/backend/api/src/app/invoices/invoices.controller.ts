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
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { InvoicesService, InvoiceListQuery } from './invoices.service';
import { InvoiceRendererService } from './services/invoice-renderer.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CreateCreditNoteDto } from './dto/create-credit-note.dto';
import { IssueInvoiceDto } from './dto/issue-invoice.dto';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import type { HttpResponse as Response } from '../common/http/http.types';
import { PeriodLockGuard } from '../accounting/guards/period-lock.guard';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { CheckPlanLimit } from '../saas/decorators/plan-limit.decorator';
import { PlanLimitCheckGuard } from '../saas/guards/plan-limit-check.guard';
import { SaasResource } from '../saas/enums/saas-resource.enum';
import { AuthenticatedUser } from '../security/principal';
import { InvoiceStatus } from './entities/invoice.entity';
import { Idempotent } from '../shared/idempotency/idempotent.decorator';

import { MailService } from '../mail/mail.service';
import { SendInvoiceDto } from './dto/send-invoice.dto';
import { Throttle } from '@nestjs/throttler';
import { BadRequestError } from '../i18n/localized.exception';
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
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly renderer: InvoiceRendererService,
    private readonly mail: MailService,
  ) {}

  @Post()
  @UseGuards(PeriodLockGuard, PlanLimitCheckGuard)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  @CheckPlanLimit(SaasResource.INVOICES, 1)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.create(dto, user.organizationId, user.id);
  }

  /**
   * What the document would come to, without creating anything.
   *
   * The invoice form used to compute its own totals to show a running figure. That was a second
   * implementation of the document arithmetic, and it had already diverged — it charged tax on the
   * base *before* the document discount, which the server spent a release fixing. The form now
   * asks; the number on screen while composing is the number that will be issued.
   *
   * Reads only: no numbering, no stock, no posting, nothing written. Guarded by the same
   * permission as creation, because it discloses catalogue prices, tax treatment and the buyer's
   * withholding regime.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  preview(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.preview(dto, user.organizationId);
  }

  /**
   * What issuing this draft would do, without doing it.
   *
   * Deliberately NOT `@Idempotent()`: a preview commits nothing, so repeating it is free and
   * requiring a key would be ceremony without a purpose. It carries the same permission as issuing,
   * because seeing the journal entry a document would post is seeing the document's accounting.
   *
   * `PeriodLockGuard` is not applied either — a closed period is one of the answers this endpoint
   * exists to give, and blocking the question would leave the user with the same silence the
   * preview is meant to end.
   */
  @Post(':id/issue/preview')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  @HttpCode(HttpStatus.OK)
  previewIssue(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: IssueInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.previewIssue(id, user.organizationId, dto.fiscalDocumentType);
  }

  /** Issue a draft: assigns the fiscal number, posts the ledger entry and transmits the e-CF. */
  @Post(':id/issue')
  @Idempotent()
  @UseGuards(PeriodLockGuard, PlanLimitCheckGuard)
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  @CheckPlanLimit(SaasResource.INVOICES, 1)
  @HttpCode(HttpStatus.OK)
  issue(
    @Param('id', UuidParamPipe) id: string,
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
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CreateInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invoicesService.updateDraft(id, dto, user.organizationId);
  }

  @Delete(':id')
  @HasPermission(PERMISSIONS.INVOICES_EDIT)
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardDraft(
    @Param('id', UuidParamPipe) id: string,
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
      branchId: query.branchId,
      actorUserId: user.id,
      from: query.from,
      to: query.to,
      search: query.search,
      sort: query.sort,
      direction: query.direction,
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
  findOne(@Param('id', UuidParamPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicesService.findOne(id, user.organizationId, user.id);
  }

  @Post(':id/credit-note')
  @Idempotent()
  @UseGuards(PeriodLockGuard)
  @HasPermission(PERMISSIONS.INVOICES_VOID)
  @HttpCode(HttpStatus.CREATED)
  createCreditNote(
    @Param('id', UuidParamPipe) id: string,
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
    @Param('id', UuidParamPipe) id: string,
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
        `attachment; filename="${invoice.fiscalNumber ?? invoice.invoiceNumber}.pdf"`,
      )
      .header('Content-Length', String(pdf.length))
      .send(pdf);
  }

  /**
   * Send the invoice to the customer by e-mail, with its PDF attached (QA A-09).
   *
   * The toolbar's "Enviar por correo" was wired to nothing. The address defaults to the customer's
   * on file; the operator may send it elsewhere (the customer's accounts-payable desk, say). A
   * draft has no fiscal number and is not something to send a customer. Throttled: this renders a
   * PDF and queues mail on every call.
   */
  @Post(':id/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async send(
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: SendInvoiceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { invoice, context } = await this.invoicesService.renderContext(id, user.organizationId);
    if (invoice.status === InvoiceStatus.DRAFT) {
      throw new BadRequestError('invoices.draft_cannot_be_sent');
    }
    const to = dto.to?.trim() || invoice.customer?.email || null;
    if (!to) {
      throw new BadRequestError('invoices.customer_has_no_email');
    }
    const pdf = await this.renderer.renderPdf(context);
    const number = invoice.fiscalNumber ?? invoice.invoiceNumber;
    // The company's name as sender and its address for replies: a customer answering an invoice
    // writes to whoever billed them, not to the software vendor.
    const identity = await this.invoicesService.senderIdentity(user.organizationId);
    await this.mail.sendInvoiceEmail({
      identity: { senderName: identity.senderName, replyTo: identity.replyTo, copyTo: identity.copyTo },
      to,
      language: invoice.customer?.preferredLanguage ?? null,
      invoiceNumber: number,
      customerName: invoice.customer?.companyName ?? '',
      companyName: context.organization.legalName,
      total: `${invoice.currencyCode ?? ''} ${Number(invoice.total ?? 0).toFixed(2)}`.trim(),
      dueDate: invoice.dueDate ? String(invoice.dueDate).slice(0, 10) : null,
      message: dto.message ?? null,
      pdf,
    });
    return { queued: true, to };
  }

  /** The same representation as HTML, for on-screen printing without a round trip to Chromium. */
  @Get(':id/print')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async printable(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const { context } = await this.invoicesService.renderContext(id, user.organizationId);
    const html = await this.renderer.renderHtml(context);
    res.header('Content-Type', 'text/html; charset=utf-8').send(html);
  }
}
