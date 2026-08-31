import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { readFile, unlink } from 'fs/promises';
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
  ) {}

  @Post('certificates')
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  @UseInterceptors(FastifyFileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadCertificate(
    @UploadedFile() file: FastifyFile,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file?.path) throw new BadRequestException('Debe adjuntar el archivo del certificado (.p12/.pfx).');

    // With attachFieldsToBody, text fields arrive either raw or wrapped as `{ value }`.
    const password = this.field(body, 'password');
    const alias = this.field(body, 'alias');
    if (!password) throw new BadRequestException('La contraseña del certificado es obligatoria.');

    try {
      const pfx = await readFile(file.path);
      return await this.certificates.upload(user.organizationId, { pfx, password, alias });
    } finally {
      await unlink(file.path).catch(() => undefined);
    }
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
    if (!submission) throw new NotFoundException('Esta factura no tiene un e-CF asociado.');
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
    if (!submission?.signedXml) throw new NotFoundException('No hay un e-CF firmado para esta factura.');
    res
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${submission.ncf}.xml"`)
      .send(submission.signedXml);
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
