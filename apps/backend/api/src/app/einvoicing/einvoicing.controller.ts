import { Controller, Get, Post, Delete, Query, Param, Body, UseGuards, UseInterceptors, UploadedFile, ParseUUIDPipe, Res } from '@nestjs/common';
import { FastifyFileInterceptor } from '../common/interceptors/fastify-file.interceptor';
import { FastifyFile } from '../common/interfaces/fastify-file.interface';
import { JwtAuthGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HasPermission } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { HttpResponse as Response } from '../common/http/http.types';
import { EcfCertificateService } from './services/ecf-certificate.service';
import { EcfSubmissionService } from './services/ecf-submission.service';
import { EcfLifecycleService } from './services/ecf-lifecycle.service';
import { CommercialApprovalDto } from './dto/commercial-approval.dto';
import { VoidSequenceRangeDto } from './dto/void-sequence-range.dto';
import { EcfMessageKind } from './entities/ecf-lifecycle-message.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

/**
 * Tenant-facing e-CF operations: manage the DGII signing certificate, inspect a document's e-CF
 * status, and trigger a (re)submission. Certificate mutations require company-settings permission;
 * document operations require the invoice permissions.
 */
@Controller('einvoicing')
@UseGuards(JwtAuthGuard)
export class EinvoicingController {
  constructor(
    private readonly certificates: EcfCertificateService,
    private readonly submissions: EcfSubmissionService,
    private readonly lifecycle: EcfLifecycleService,
  ) {}

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
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestError('EINVOICING.DEBE_ADJUNTAR_ARCHIVO_CERTIFICADO_P12_PFX');
    }

    // With attachFieldsToBody, text fields arrive either raw or wrapped as `{ value }`.
    const password = this.field(body, 'password');
    const alias = this.field(body, 'alias');
    if (!password) throw new BadRequestError('EINVOICING.CONTRASENA_CERTIFICADO_ES_OBLIGATORIA');

    return this.certificates.upload(user.organizationId, { pfx: file.buffer, password, alias });
  }

  @Get('certificates')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  listCertificates(@CurrentUser() user: AuthenticatedUser) {
    return this.certificates.list(user.organizationId);
  }

  @Delete('certificates/:id')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  async deactivateCertificate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.certificates.deactivate(user.organizationId, id);
    return { success: true };
  }

  @Get('invoices/:invoiceId/status')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async status(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const submission = await this.submissions.findByInvoice(invoiceId, user.organizationId);
    if (!submission) throw new NotFoundError('EINVOICING.ESTA_FACTURA_NO_TIENE_CF_ASOCIADO');
    return this.toStatusView(submission);
  }

  @Post('invoices/:invoiceId/submit')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  async submit(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const submission = await this.submissions.submitInvoice(invoiceId, user.organizationId);
    return this.toStatusView(submission);
  }

  @Get('invoices/:invoiceId/xml')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async downloadXml(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const submission = await this.submissions.findByInvoice(invoiceId, user.organizationId);
    if (!submission?.signedXml) throw new NotFoundError('EINVOICING.NO_HAY_CF_FIRMADO_ESTA_FACTURA');
    res
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${submission.ncf}.xml"`)
      .send(submission.signedXml);
  }

  // ── Aprobación comercial ───────────────────────────────────────────────────

  /**
   * Answer a comprobante a supplier issued to this tenant.
   *
   * `INVOICES_VIEW` would be wrong: accepting a supplier's comprobante commits the tenant to the
   * purchase and to the ITBIS credit it carries, and rejecting it is a formal dispute. It is an
   * act on payables, so it takes the create permission.
   */
  @Post('received/approval')
  @HasPermission(PERMISSIONS.INVOICES_CREATE)
  async answerReceived(
    @Body() dto: CommercialApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const message = await this.lifecycle.answerReceived(user.organizationId, dto);
    return this.toMessageView(message);
  }

  // ── Anulación de e-NCF ─────────────────────────────────────────────────────

  /**
   * Declare a stretch of an authorized e-NCF range as annulled.
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
    const message = await this.lifecycle.voidRange(user.organizationId, dto);
    return this.toMessageView(message);
  }

  /** Everything this tenant has sent outside the comprobante flow, newest first. */
  @Get('messages')
  @HasPermission(PERMISSIONS.INVOICES_VIEW)
  async listMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query('kind') kind?: string,
  ) {
    if (kind && !(kind in EcfMessageKind)) {
      throw new BadRequestError('EINVOICING.TIPO_MENSAJE_DESCONOCIDO_USA_COMMERCIAL_APPROVAL_SEQUENCE', { kind });
    }
    const messages = await this.lifecycle.list(
      user.organizationId,
      kind ? (kind as EcfMessageKind) : undefined,
    );
    return messages.map((message) => this.toMessageView(message));
  }

  /**
   * The shape a client may see.
   *
   * The signed XML is deliberately absent: it carries the tenant's signature over its own RNC and
   * is served only by the explicit download route, which is permissioned separately.
   */
  private toMessageView(m: {
    id: string;
    kind: EcfMessageKind;
    issuerRnc?: string | null;
    ncf?: string | null;
    ecfType?: string | null;
    sequenceFrom?: string | null;
    sequenceTo?: string | null;
    verdict?: string | null;
    rejectionReason?: string | null;
    status: string;
    trackId?: string | null;
    messages?: string[] | null;
    sentAt?: Date | null;
    respondedAt?: Date | null;
    createdAt: Date;
  }) {
    return {
      id: m.id,
      kind: m.kind,
      issuerRnc: m.issuerRnc ?? null,
      ncf: m.ncf ?? null,
      ecfType: m.ecfType ?? null,
      sequenceFrom: m.sequenceFrom ?? null,
      sequenceTo: m.sequenceTo ?? null,
      verdict: m.verdict ?? null,
      rejectionReason: m.rejectionReason ?? null,
      status: m.status,
      trackId: m.trackId ?? null,
      messages: m.messages ?? [],
      sentAt: m.sentAt ?? null,
      respondedAt: m.respondedAt ?? null,
      createdAt: m.createdAt,
    };
  }

  private toStatusView(s: {
    ncf: string;
    ecfType: string;
    status: string;
    trackId?: string;
    securityCode?: string;
    qrUrl?: string;
    messages?: string[];
    sentAt?: Date;
    respondedAt?: Date;
  }) {
    return {
      ncf: s.ncf,
      ecfType: s.ecfType,
      status: s.status,
      trackId: s.trackId ?? null,
      securityCode: s.securityCode ?? null,
      qrUrl: s.qrUrl ?? null,
      messages: s.messages ?? [],
      sentAt: s.sentAt ?? null,
      respondedAt: s.respondedAt ?? null,
    };
  }

  private field(body: Record<string, unknown>, key: string): string {
    const raw = body?.[key];
    if (raw == null) return '';
    if (typeof raw === 'string') return raw;
    const wrapped = raw as { value?: unknown };
    return typeof wrapped.value === 'string' ? wrapped.value : String(wrapped.value ?? '');
  }
}
