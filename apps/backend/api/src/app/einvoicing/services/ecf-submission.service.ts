import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EcfSubmission, EcfStatus } from '../entities/ecf-submission.entity';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import { Invoice, InvoiceType } from '../../invoices/entities/invoice.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { EcfSignerService } from './ecf-signer.service';
import { EcfXmlBuilderService, EcfBuildContext, EcfItemInput } from './ecf-xml-builder.service';
import { DgiiAuthService } from './dgii-auth.service';
import { DgiiTransportService } from './dgii-transport.service';
import { DgiiConfigService } from './dgii-config.service';
import { mapDgiiEstado, isTerminalStatus } from '../ecf-status.util';
import { BadRequestError, NotFoundError } from '../../i18n/localized.exception';

/**
 * Orchestrates the full e-CF lifecycle for one invoice: build → sign → transmit → track. It is
 * designed to run OUTSIDE the invoice-creation transaction (invoked asynchronously) so a slow or
 * unreachable DGII never blocks or rolls back the sale. When the DGII is unreachable the document is
 * marked CONTINGENCY and retried by the reconciler.
 */
@Injectable()
export class EcfSubmissionService {
  private readonly logger = new Logger(EcfSubmissionService.name);

  constructor(
    @InjectRepository(EcfSubmission)
    private readonly submissionRepo: Repository<EcfSubmission>,
    @InjectRepository(EcfCertificate)
    private readonly certRepo: Repository<EcfCertificate>,
    @InjectRepository(Invoice)
    private readonly invoiceRepo: Repository<Invoice>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly vault: CertificateVaultService,
    private readonly signer: EcfSignerService,
    private readonly builder: EcfXmlBuilderService,
    private readonly auth: DgiiAuthService,
    private readonly transport: DgiiTransportService,
    private readonly dgiiConfig: DgiiConfigService,
  ) {}

  /**
   * Builds, signs and transmits the e-CF for an invoice that already carries an electronic e-NCF.
   * Idempotent per invoice: an existing terminal submission is returned untouched.
   */
  async submitInvoice(invoiceId: string, organizationId: string): Promise<EcfSubmission> {
    const existing = await this.submissionRepo.findOne({ where: { invoiceId } });
    if (existing && isTerminalStatus(existing.status)) {
      return existing;
    }

    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, organizationId },
      relations: ['lineItems', 'customer'],
    });
    if (!invoice) throw new NotFoundError('EINVOICING.FACTURA_NO_ENCONTRADA', { invoiceId });
    if (!invoice.ncfNumber || !invoice.ncfNumber.startsWith('E')) {
      throw new BadRequestError('EINVOICING.FACTURA_NO_TIENE_NCF_ELECTRONICO_ASIGNADO');
    }

    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundError('EINVOICING.ORGANIZACION_NO_ENCONTRADA');
    if (!org.taxId) throw new BadRequestError('EINVOICING.ORGANIZACION_NO_TIENE_RNC_CONFIGURADO');

    const cert = await this.certRepo.findOne({
      where: { organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (!cert) {
      throw new BadRequestError('EINVOICING.NO_HAY_CERTIFICADO_DIGITAL_ACTIVO_FIRMAR_CF');
    }
    if (cert.notAfter && cert.notAfter.getTime() < Date.now()) {
      throw new BadRequestError('EINVOICING.CERTIFICADO_DIGITAL_VENCIO', { p1: cert.notAfter.toISOString().split('T')[0] });
    }

    const loaded = this.vault.load(cert);

    const submission =
      existing ??
      this.submissionRepo.create({
        organizationId,
        invoiceId,
        ncf: invoice.ncfNumber,
        ecfType: invoice.ncfNumber.substring(1, 3),
        status: EcfStatus.PENDING,
        attempts: 0,
      });

    // 1. Build + sign.
    const fechaHoraFirma = this.stampNow();
    const ctx = await this.buildContext(invoice, org, fechaHoraFirma);
    const xml = this.builder.build(ctx);
    const signedXml = this.signer.sign(xml, loaded, 'ECF');
    const securityCode = this.signer.securityCode(signedXml);

    submission.signedXml = signedXml;
    submission.securityCode = securityCode;
    submission.qrUrl = this.buildQrUrl(ctx, securityCode, fechaHoraFirma);
    submission.status = EcfStatus.SIGNED;
    submission.attempts += 1;
    await this.submissionRepo.save(submission);

    // 2. Transmit. A DGII outage is not a failure of the sale — mark contingency and let the
    //    reconciler retry.
    try {
      const token = await this.auth.getToken(organizationId, loaded);
      const result = await this.transport.sendEcf(token, signedXml, invoice.ncfNumber);
      submission.trackId = result.trackId;
      submission.dgiiResponse = result.raw;
      submission.messages = result.mensajes;
      submission.sentAt = new Date();
      submission.status = result.estado ? mapDgiiEstado(result.estado) : EcfStatus.SENT;
      if (isTerminalStatus(submission.status)) submission.respondedAt = new Date();
    } catch (err) {
      if (err instanceof ServiceUnavailableException) {
        submission.status = EcfStatus.CONTINGENCY;
        submission.messages = [(err as Error).message];
        this.logger.warn(`e-CF ${invoice.ncfNumber} en contingencia: ${(err as Error).message}`);
      } else {
        submission.status = EcfStatus.ERROR;
        submission.messages = [(err as Error).message];
        this.logger.error(`Error al transmitir e-CF ${invoice.ncfNumber}: ${(err as Error).message}`);
      }
    }

    return this.submissionRepo.save(submission);
  }

  /** Polls the DGII for a non-terminal submission and updates its verdict. */
  async pollStatus(submission: EcfSubmission): Promise<EcfSubmission> {
    if (!submission.trackId || isTerminalStatus(submission.status)) return submission;

    const cert = await this.certRepo.findOne({
      where: { organizationId: submission.organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (!cert) return submission;

    const loaded = this.vault.load(cert);
    const token = await this.auth.getToken(submission.organizationId, loaded);
    const result = await this.transport.queryStatus(token, submission.trackId);

    submission.status = mapDgiiEstado(result.estado);
    submission.dgiiResponse = result.raw;
    submission.messages = result.mensajes;
    if (isTerminalStatus(submission.status)) submission.respondedAt = new Date();
    return this.submissionRepo.save(submission);
  }

  async findByInvoice(invoiceId: string, organizationId: string): Promise<EcfSubmission | null> {
    return this.submissionRepo.findOne({ where: { invoiceId, organizationId } });
  }

  /** Non-terminal submissions with a trackId, oldest first — used by the reconciler. */
  findPollable(limit = 50): Promise<EcfSubmission[]> {
    return this.submissionRepo
      .createQueryBuilder('s')
      .where('s.trackId IS NOT NULL')
      .andWhere('s.status = :sent', { sent: EcfStatus.SENT })
      .orderBy('s.sentAt', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Submissions that still need to reach a DGII verdict: contingency/error (a prior attempt failed)
   * plus pending/signed (built and possibly signed but never transmitted — e.g. the process
   * restarted mid-flight). All are safe to re-run because submitInvoice is idempotent per invoice.
   */
  findRetriable(limit = 50): Promise<EcfSubmission[]> {
    return this.submissionRepo
      .createQueryBuilder('s')
      .where('s.status IN (:...states)', {
        states: [EcfStatus.CONTINGENCY, EcfStatus.ERROR, EcfStatus.PENDING, EcfStatus.SIGNED],
      })
      .orderBy('s.updatedAt', 'ASC')
      .limit(limit)
      .getMany();
  }

  private async buildContext(
    invoice: Invoice,
    org: Organization,
    fechaHoraFirma: string,
  ): Promise<EcfBuildContext> {
    const items: EcfItemInput[] = (invoice.lineItems || []).map((li) => ({
      nombre: li.description,
      indicadorBienoServicio: '1',
      cantidad: Number(li.quantity),
      precioUnitario: Number(li.price),
      itbisTasa: Number(li.taxRate) || 0,
    }));

    const tipoECF = invoice.ncfNumber!.substring(1, 3);
    const tipoPago = invoice.dueDate && invoice.dueDate > invoice.issueDate ? '2' : '1';
    const tipoIngresos = org.fiscalProfile?.tipoIngreso || '01';

    const ctx: EcfBuildContext = {
      tipoECF,
      eNCF: invoice.ncfNumber!,
      tipoIngresos,
      tipoPago,
      fechaEmision: this.toDgiiDate(invoice.issueDate),
      fechaHoraFirma,
      emisor: {
        rnc: (org.taxId || '').replace(/-/g, ''),
        razonSocial: org.legalName,
        direccion: org.address || undefined,
        municipio: org.city || undefined,
        provincia: org.state || undefined,
      },
      comprador: {
        rnc: invoice.customer?.taxId?.replace(/-/g, '') || undefined,
        razonSocial: invoice.customerName || invoice.customer?.companyName || undefined,
      },
      items,
    };

    // Nota de crédito/débito electrónica: reference the modified comprobante.
    if (invoice.type === InvoiceType.CREDIT_NOTE && invoice.originalInvoiceId) {
      const original = await this.invoiceRepo.findOne({
        where: { id: invoice.originalInvoiceId, organizationId: invoice.organizationId },
        select: ['id', 'ncfNumber', 'issueDate'],
      });
      if (original?.ncfNumber) {
        ctx.modifica = {
          eNCFModificado: original.ncfNumber,
          fechaEmisionModificado: this.toDgiiDate(original.issueDate),
          // 3 = corrige montos (caso común de una nota de crédito que reduce importes).
          codigoModificacion: '3',
        };
      }
    }

    return ctx;
  }

  private buildQrUrl(ctx: EcfBuildContext, securityCode: string, fechaHoraFirma: string): string {
    const endpoints = this.dgiiConfig.endpoints;
    const base = ctx.tipoECF === '32' ? endpoints.timbreConsumo : endpoints.timbre;
    const montoTotal = this.computeMontoTotal(ctx.items);
    const params = new URLSearchParams();
    params.set('RncEmisor', ctx.emisor.rnc);
    if (ctx.comprador?.rnc) params.set('RncComprador', ctx.comprador.rnc);
    params.set('ENCF', ctx.eNCF);
    params.set('FechaEmision', ctx.fechaEmision);
    params.set('MontoTotal', montoTotal.toFixed(2));
    params.set('FechaFirma', fechaHoraFirma);
    params.set('CodigoSeguridad', securityCode);
    return `${base}?${params.toString()}`;
  }

  private computeMontoTotal(items: EcfItemInput[]): number {
    let total = 0;
    for (const item of items) {
      const monto = item.cantidad * item.precioUnitario;
      total += monto + monto * (Number(item.itbisTasa) || 0);
    }
    return Math.round((total + Number.EPSILON) * 100) / 100;
  }

  private toDgiiDate(isoDate: string): string {
    // 'YYYY-MM-DD' (or ISO datetime) -> 'DD-MM-YYYY'.
    const datePart = (isoDate || '').split('T')[0];
    const [y, m, d] = datePart.split('-');
    if (!y || !m || !d) return datePart;
    return `${d}-${m}-${y}`;
  }

  private stampNow(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
}
