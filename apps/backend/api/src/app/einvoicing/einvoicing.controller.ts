import { UploadCertificateFieldsDto } from './dto/upload-certificate.dto';
import { Controller, Get, Post, Delete, Query, Param, Body, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import type { HttpResponse as Response } from '../common/http/http.types';
import { SigningCertificateService } from './services/signing-certificate.service';
import { FiscalSubmissionService, visibleSubmission } from './services/fiscal-submission.service';
import { FiscalDocumentEventsService } from './services/fiscal-document-events.service';
import { FiscalRegimeRegistry } from './regimes/fiscal-regime.registry';
import { TenantCountryResolver } from '../shared/tenancy/tenant-country.resolver';
import { CounterpartyVerdictDto } from './dto/counterparty-verdict.dto';
import { VoidSequenceRangeDto } from './dto/void-sequence-range.dto';
import { FiscalDocumentEvent, FiscalDocumentEventKind } from './entities/fiscal-document-event.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

/**
 * Tenant-facing electronic-invoicing operations: manage the signing certificate, inspect where a
 * document stands with its authority, and trigger a (re)submission. Certificate mutations require
 * company-settings permission; document operations require the invoice permissions.
 *
 * One set of routes for every market: the Dominican e-CF had its own pipeline and its own table
 * until its regime became an adapter like the others, and these routes answered for it alone.
 */
@Controller('einvoicing')
export class EinvoicingController {
  constructor(
    private readonly certificates: SigningCertificateService,
    private readonly submissions: FiscalSubmissionService,
    private readonly events: FiscalDocumentEventsService,
    private readonly regimes: FiscalRegimeRegistry,
    private readonly organizations: TenantCountryResolver,
  ) {}

  /**
   * What this tenant's regime does with declarations about documents.
   *
   * Resolved through the registry: the door named the Dominican service, so a market whose
   * authority receives these would have had to be added here rather than in its own package.
   */
  private async documentEvents(organizationId: string) {
    const country = await this.organizations.resolve(organizationId);
    const port = this.regimes.forCountry(country)?.documentEvents;
    if (!port) {
      throw new BadRequestError('einvoicing.market_receives_no_document_events', { country });
    }
    return port;
  }

  @Post('certificates')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  @UseInterceptors(
    FastifyFileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024 },
      // The PKCS#12 never touches the filesystem. It was being written to `os.tmpdir()` so the
      // handler could read it back, which put the tenant's private key on a shared filesystem for
      // as long as the request took — and left it there if the process died before the cleanup.
      persistToDisk: false,
      allowedMimeTypes: [
        'application/x-pkcs12',
        'application/pkcs12',
        'application/x-pkcs12-certificates',
        'application/octet-stream',
      ],
    }),
  )
  async uploadCertificate(
    @UploadedFile() file: FastifyFile,
    @Body() body: UploadCertificateFieldsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestError('einvoicing.you_must_attach_certificate_file_p12');
    }

    // FastifyFileInterceptor unwraps the multipart fields before the DTO is validated.
    return this.certificates.upload(user.organizationId, { pfx: file.buffer, password: body.password, alias: body.alias ?? '' });
  }

  @Get('certificates')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  listCertificates(@CurrentUser() user: AuthenticatedUser) {
    return this.certificates.list(user.organizationId);
  }

  @Delete('certificates/:id')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  async deactivateCertificate(
    @Param('id', UuidParamPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.certificates.deactivate(user.organizationId, id);
    return { success: true };
  }

  /**
   * What the DGII knows about this invoice, or `null`.
   *
   * `null`, not `404`. "Has this document been transmitted yet?" is a legitimate question whose
   * answer is often "no": a tenant without a certificate has no submission for any of its
   * invoices, and the invoice screen asks on every open. Answering `404` made a normal state an
   * error — one console line per document opened, and a client that has to catch a failure to
   * learn something ordinary. A `404` here would mean the INVOICE does not exist, and it does.
   */
  @Get('invoices/:invoiceId/status')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async status(
    @Param('invoiceId', UuidParamPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const submission = await this.submissions.findByInvoice(invoiceId, user.organizationId);
    return submission ? visibleSubmission(submission) : null;
  }

  /**
   * Transmit it now, or ask again about one already transmitted.
   *
   * A verdict the authority has already given is not reopened: `retryNow` answers 409 for it,
   * because a second transmission of an accepted document is a second fiscal document.
   */
  @Post('invoices/:invoiceId/submit')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  async submit(
    @Param('invoiceId', UuidParamPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const existing = await this.submissions.findByInvoice(invoiceId, user.organizationId);
    const submission = existing
      ? await this.submissions.retryNow(existing.id, user.organizationId)
      : await this.submissions.process(invoiceId, user.organizationId);
    if (!submission) throw new NotFoundError('einvoicing.submission_not_found');
    return visibleSubmission(submission);
  }

  @Get('invoices/:invoiceId/xml')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async downloadXml(
    @Param('invoiceId', UuidParamPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const submission = await this.submissions.findByInvoice(invoiceId, user.organizationId);
    if (!submission?.payload) throw new NotFoundError('einvoicing.no_signed_cf_invoice');
    res
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${submission.fiscalNumber ?? submission.invoiceId}.xml"`)
      .send(submission.payload);
  }

  // ── What a taxpayer tells the authority ABOUT documents ────────────────────

  /**
   * Answer a document a counterparty issued to this tenant.
   *
   * `INVOICES_VIEW` would be wrong: accepting a supplier's document commits the tenant to the
   * purchase and to the tax credit it carries, and rejecting it is a formal dispute. It is an act
   * on payables, so it takes the create permission.
   */
  @Post('received/approval')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  async answerReceived(
    @Body() dto: CounterpartyVerdictDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const port = await this.documentEvents(user.organizationId);
    return this.toEventView(await port.answerReceived(user.organizationId, dto));
  }

  /**
   * Declare a stretch of an authorised range as annulled.
   *
   * Guarded by `INVOICES_VOID`: it permanently removes fiscal numbers from circulation, which is
   * closer to voiding a document than to issuing one.
   */
  @Post('sequences/void')
  @HasPermission(PERMISSIONS.INVOICES_VOID)
  async voidSequenceRange(
    @Body() dto: VoidSequenceRangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const port = await this.documentEvents(user.organizationId);
    return this.toEventView(await port.voidRange(user.organizationId, dto));
  }

  /** Everything this tenant has declared about documents, newest first. */
  @Get('messages')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind?: string,
  ) {
    if (kind && !(kind in FiscalDocumentEventKind)) {
      throw new BadRequestError('einvoicing.unknown_message_type_kind_use_commercial', { kind });
    }
    const events = await this.events.list(user.organizationId, kind ? (kind as FiscalDocumentEventKind) : undefined);
    return events.map((event) => this.toEventView(event));
  }

  /**
   * The shape a client may see.
   *
   * The sealed declaration is deliberately absent: it carries the tenant's signature over its own
   * identifier and is served only by the explicit download route, which is permissioned separately.
   */
  private toEventView(event: FiscalDocumentEvent) {
    return {
      id: event.id,
      countryCode: event.countryCode,
      regime: event.regime,
      kind: event.kind,
      counterpartyTaxId: event.counterpartyTaxId ?? null,
      documentNumber: event.documentNumber ?? null,
      documentType: event.documentType ?? null,
      sequenceFrom: event.sequenceFrom ?? null,
      sequenceTo: event.sequenceTo ?? null,
      verdict: event.verdict ?? null,
      rejectionReason: event.rejectionReason ?? null,
      status: event.status,
      trackingId: event.trackingId ?? null,
      messages: event.messages ?? [],
      sentAt: event.sentAt ?? null,
      respondedAt: event.respondedAt ?? null,
      createdAt: event.createdAt,
    };
  }
}
