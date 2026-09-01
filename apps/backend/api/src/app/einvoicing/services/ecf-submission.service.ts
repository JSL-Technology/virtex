import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EcfSubmission, EcfStatus } from '../entities/ecf-submission.entity';
import { EcfCertificate } from '../entities/ecf-certificate.entity';
import { Invoice, InvoiceType, PaymentMethod } from '../../invoices/entities/invoice.entity';
import { TaxTreatment } from '../../invoices/entities/invoice-line-item.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { CertificateVaultService } from './certificate-vault.service';
import { EcfSignerService } from './ecf-signer.service';
import {
  EcfXmlBuilderService,
  EcfBuildContext,
  EcfItemInput,
  EcfFormaPago,
} from './ecf-xml-builder.service';
import { EcfValidatorService, EcfValidationError } from './ecf-validator.service';
import { DgiiAuthService } from './dgii-auth.service';
import { DgiiTransportService } from './dgii-transport.service';
import { DgiiConfigService } from './dgii-config.service';
import { mapDgiiEstado, isTerminalStatus } from '../ecf-status.util';
import {
  incomeTypeCode,
  municipalityCode,
  paymentFormCode,
  provinceCode,
  unitOfMeasureCode,
} from '../config/dgii-catalogues';
import { dgiiTimestamp, organizationTimeZone } from '../../shared/fiscal-clock';

/**
 * Orchestrates the full e-CF lifecycle for one document: build → validate → sign → transmit → track.
 *
 * ## Three defects this closes
 *
 * **A tenant could read another tenant's comprobante.** The method opened with
 * `findOne({ where: { invoiceId } })` — no organization filter — and returned early when the status
 * was terminal, BEFORE loading the invoice (which is filtered). So `POST /einvoicing/invoices/:id/
 * submit` handed any authenticated user the e-NCF, trackId, security code and timbre URL — carrying
 * both parties' RNC — of any invoice whose id they could guess. Every lookup here is now scoped by
 * organization.
 *
 * **A failed pre-flight consumed an e-NCF and left no trace.** Every validation — no RNC, no
 * certificate, expired certificate — threw before the `ecf_submissions` row was created. The
 * invoice kept its fiscal number, the DGII never received it, and the reconciler could not find it
 * because it scans that table. The row is now created FIRST, so every assigned number has a record
 * and a retry path, whatever fails afterwards.
 *
 * **Nothing was validated before transmission.** Documents went to the DGII unchecked; the first
 * sign of a missing address or an unidentified buyer was a rejection. `EcfValidatorService` runs
 * before signing and its findings are stored on the submission, in the tenant's own language.
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
    @InjectRepository(OrganizationSettings)
    private readonly settingsRepo: Repository<OrganizationSettings>,
    private readonly vault: CertificateVaultService,
    private readonly signer: EcfSignerService,
    private readonly builder: EcfXmlBuilderService,
    private readonly validator: EcfValidatorService,
    private readonly auth: DgiiAuthService,
    private readonly transport: DgiiTransportService,
    private readonly dgiiConfig: DgiiConfigService,
  ) {}

  /**
   * Build, validate, sign and transmit the e-CF for a document that carries an electronic e-NCF.
   * Idempotent per invoice: an existing terminal submission is returned untouched.
   */
  async submitInvoice(invoiceId: string, organizationId: string): Promise<EcfSubmission> {
    const invoice = await this.invoiceRepo.findOne({
      where: { id: invoiceId, organizationId },
      relations: ['lineItems', 'customer'],
    });
    if (!invoice) throw new NotFoundException(`Factura ${invoiceId} no encontrada.`);
    if (!invoice.isElectronicFiscalDocument) {
      throw new BadRequestException('La factura no tiene un e-NCF electrónico asignado.');
    }

    // Scoped by tenant, and read only after the invoice has been resolved within the tenant.
    const existing = await this.submissionRepo.findOne({ where: { invoiceId, organizationId } });
    if (existing && isTerminalStatus(existing.status)) return existing;

    // The row exists BEFORE anything can fail, so an assigned e-NCF is never invisible.
    const submission =
      existing ??
      (await this.submissionRepo.save(
        this.submissionRepo.create({
          organizationId,
          invoiceId,
          ncf: invoice.ncfNumber as string,
          ecfType: (invoice.ncfNumber as string).substring(1, 3),
          status: EcfStatus.PENDING,
          attempts: 0,
        }),
      ));

    try {
      return await this.buildSignAndSend(invoice, submission, organizationId);
    } catch (error) {
      return this.recordFailure(submission, error);
    }
  }

  private async buildSignAndSend(
    invoice: Invoice,
    submission: EcfSubmission,
    organizationId: string,
  ): Promise<EcfSubmission> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organización no encontrada.');
    if (!org.taxId) {
      throw new BadRequestException(
        'La organización no tiene RNC configurado. Complétalo en Ajustes → Empresa.',
      );
    }

    const cert = await this.certRepo.findOne({
      where: { organizationId, isActive: true },
      order: { createdAt: 'DESC' },
    });
    if (!cert) {
      throw new BadRequestException(
        'No hay un certificado digital activo para firmar e-CF. Cárgalo en Ajustes → Facturación Electrónica.',
      );
    }
    if (cert.notAfter && cert.notAfter.getTime() < Date.now()) {
      throw new BadRequestException(
        `El certificado digital venció el ${cert.notAfter.toISOString().split('T')[0]}. ` +
          `Carga el certificado renovado antes de transmitir.`,
      );
    }

    const loaded = this.vault.load(cert);

    // 1. Build and validate before spending a signature on a document the DGII would reject.
    const fechaHoraFirma = this.stampNow(org);
    const ctx = await this.buildContext(invoice, org, fechaHoraFirma);
    const montoTotal = this.builder.montoTotal(ctx);
    this.validator.assertValid(ctx, montoTotal);

    const xml = this.builder.build(ctx);
    const signedXml = this.signer.sign(xml, loaded, 'ECF');
    const securityCode = this.signer.securityCode(signedXml);

    submission.signedXml = signedXml;
    submission.securityCode = securityCode;
    // The QR quotes the total the builder computed — one number, one source.
    submission.qrUrl = this.buildQrUrl(ctx, securityCode, fechaHoraFirma, montoTotal);
    submission.status = EcfStatus.SIGNED;
    submission.attempts += 1;
    submission.messages = [];
    await this.submissionRepo.save(submission);

    // 2. Transmit. A DGII outage is not a failure of the sale — mark contingency and let the
    //    reconciler retry.
    const token = await this.auth.getToken(organizationId, loaded);

    // Idempotency: if a previous attempt reached the DGII before the connection dropped, adopt its
    // trackId instead of submitting the same comprobante twice.
    const adopted = await this.adoptExistingTrackId(token, org.taxId, ctx.eNCF, submission);
    if (adopted) return adopted;

    const result = await this.transport.sendEcf(token, signedXml, invoice.ncfNumber!, ctx.tipoECF);
    submission.trackId = result.trackId;
    submission.dgiiResponse = result.raw;
    submission.messages = result.mensajes;
    submission.sentAt = new Date();
    submission.status = result.estado ? mapDgiiEstado(result.estado) : EcfStatus.SENT;
    if (isTerminalStatus(submission.status)) submission.respondedAt = new Date();

    return this.submissionRepo.save(submission);
  }

  /** Record why a submission could not proceed, distinguishing an outage from a bad document. */
  private async recordFailure(submission: EcfSubmission, error: unknown): Promise<EcfSubmission> {
    if (error instanceof ServiceUnavailableException) {
      submission.status = EcfStatus.CONTINGENCY;
      submission.messages = [(error as Error).message];
      this.logger.warn(`e-CF ${submission.ncf} en contingencia: ${(error as Error).message}`);
    } else if (error instanceof EcfValidationError) {
      // A document that does not satisfy the format will not satisfy it on a retry either. It is an
      // error the tenant has to fix, so it is stored with the field-by-field detail.
      submission.status = EcfStatus.ERROR;
      submission.messages = error.issues.map((issue) => `${issue.field}: ${issue.message}`);
      this.logger.error(`e-CF ${submission.ncf} inválido: ${error.message}`);
    } else {
      submission.status = EcfStatus.ERROR;
      submission.messages = [(error as Error).message];
      this.logger.error(
        `Error al transmitir e-CF ${submission.ncf}: ${(error as Error).message}`,
      );
    }
    submission.attempts += 1;
    return this.submissionRepo.save(submission);
  }

  /**
   * Ask the DGII whether it already holds this e-NCF before sending it again.
   *
   * Without this, a retry after a network timeout resubmits a comprobante the DGII may already have
   * accepted. The check is best-effort: if the lookup itself fails we proceed to send, because
   * refusing to transmit is worse than a duplicate the DGII will reject.
   */
  private async adoptExistingTrackId(
    token: string,
    rncEmisor: string,
    eNcf: string,
    submission: EcfSubmission,
  ): Promise<EcfSubmission | null> {
    if (submission.attempts <= 1) return null;
    try {
      const entries = await this.transport.queryTrackIds(token, rncEmisor.replace(/\D/g, ''), eNcf);
      const existing = entries[0];
      if (!existing) return null;

      submission.trackId = existing.trackId;
      submission.sentAt = submission.sentAt ?? new Date();
      submission.status = existing.estado ? mapDgiiEstado(existing.estado) : EcfStatus.SENT;
      if (isTerminalStatus(submission.status)) submission.respondedAt = new Date();
      submission.messages = [
        `La DGII ya había recibido este e-NCF (trackId ${existing.trackId}); se adoptó en lugar de retransmitir.`,
      ];
      this.logger.log(`e-CF ${eNcf}: trackId existente ${existing.trackId} adoptado.`);
      return this.submissionRepo.save(submission);
    } catch {
      return null;
    }
  }

  /** Poll the DGII for a non-terminal submission and update its verdict. */
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
   * Submissions that still need to reach a DGII verdict: contingency (a prior attempt hit an
   * outage) plus pending/signed (built and possibly signed but never transmitted — the process
   * restarted mid-flight).
   *
   * `ERROR` is deliberately NOT retried in bulk: those are documents the DGII or the validator
   * rejected on their content, and re-sending them unchanged only repeats the rejection. They are
   * surfaced to the tenant instead, and re-submitted explicitly once corrected.
   */
  findRetriable(limit = 50): Promise<EcfSubmission[]> {
    return this.submissionRepo
      .createQueryBuilder('s')
      .where('s.status IN (:...states)', {
        states: [EcfStatus.CONTINGENCY, EcfStatus.PENDING, EcfStatus.SIGNED],
      })
      .orderBy('s.updatedAt', 'ASC')
      .limit(limit)
      .getMany();
  }

  /** Documents whose e-NCF is assigned but which the DGII has not accepted — the tenant's exposure. */
  async findUnresolved(organizationId: string): Promise<EcfSubmission[]> {
    return this.submissionRepo.find({
      where: [
        { organizationId, status: EcfStatus.ERROR },
        { organizationId, status: EcfStatus.CONTINGENCY },
        { organizationId, status: EcfStatus.REJECTED },
      ],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  // ── Context building ───────────────────────────────────────────────────────

  private async buildContext(
    invoice: Invoice,
    org: Organization,
    fechaHoraFirma: string,
  ): Promise<EcfBuildContext> {
    const items: EcfItemInput[] = (invoice.lineItems ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((line) => ({
        nombre: line.description,
        // The catalogue now classifies goods against services; every line used to be a good.
        indicadorBienoServicio: line.isService ? '2' : '1',
        cantidad: Number(line.quantity),
        unidadMedida: unitOfMeasureCode(line.unitOfMeasure),
        precioUnitario: Number(line.price),
        descuentoMonto: Number(line.discountAmount) || 0,
        itbisTasa: Number(line.taxRate) || 0,
        exento: line.taxTreatment === TaxTreatment.EXEMPT,
        montoImpuestoSelectivo: Number(line.exciseAmount) || 0,
      }));

    const tipoECF = invoice.ncfNumber!.substring(1, 3);
    const isCredit = invoice.paymentMethod === PaymentMethod.CREDIT;
    const tipoPago = isCredit ? '2' : '1';

    const settings = await this.settingsRepo.findOne({
      where: { organizationId: invoice.organizationId },
    });
    const baseCurrency = settings?.baseCurrency ?? 'DOP';

    const ctx: EcfBuildContext = {
      tipoECF,
      eNCF: invoice.ncfNumber!,
      fechaVencimientoSecuencia: invoice.ncfExpiresAt
        ? this.toDgiiDate(invoice.ncfExpiresAt)
        : undefined,
      tipoIngresos: incomeTypeCode(org.fiscalProfile?.['tipoIngreso']),
      tipoPago,
      formasPago: isCredit ? undefined : this.buildFormasPago(invoice),
      fechaLimitePago: isCredit ? this.toDgiiDate(invoice.dueDate) : undefined,
      fechaEmision: this.toDgiiDate(invoice.issueDate),
      fechaHoraFirma,
      emisor: {
        rnc: (org.taxId || '').replace(/\D/g, ''),
        razonSocial: org.legalName,
        nombreComercial: org.commercialName || undefined,
        direccion: org.address || undefined,
        municipio: municipalityCode(org.state, org.city) ?? undefined,
        provincia: provinceCode(org.state) ?? undefined,
        telefono: org.phone || undefined,
        correo: org.email || undefined,
        webSite: org.website || undefined,
        actividadEconomica: org.industry || undefined,
        numeroFacturaInterna: invoice.invoiceNumber,
      },
      comprador: {
        rnc: this.taxIdDigits(invoice.customerTaxId ?? invoice.customer?.taxId),
        razonSocial: invoice.customerName || invoice.customer?.companyName || undefined,
        direccion: invoice.customerAddress || undefined,
      },
      items,
      descuentoGlobal: Number(invoice.discountTotal) || 0,
      montoPropinaLegal: Number(invoice.serviceCharge) || 0,
      itbisRetenido: Number(invoice.taxWithheld) || 0,
      isrRetenido: Number(invoice.incomeTaxWithheld) || 0,
    };

    // A comprobante issued in a currency other than the peso must declare it, or its amounts read
    // as pesos. `exchangeRate` is base-per-transaction-unit; when the base IS the peso that is
    // exactly the DGII's TipoCambio.
    if (invoice.currencyCode !== 'DOP' && baseCurrency === 'DOP') {
      ctx.otraMoneda = {
        tipoMoneda: invoice.currencyCode,
        tipoCambio: Number(invoice.exchangeRate) || 1,
        montoGravadoTotal: Number(invoice.taxedTotal) || 0,
        montoExento: Number(invoice.exemptTotal) || 0,
        totalItbis: Number(invoice.tax) || 0,
        montoTotal: Number(invoice.total) || 0,
      };
    }

    // Nota de crédito/débito electrónica: reference the modified comprobante.
    if (invoice.type !== InvoiceType.INVOICE && invoice.originalInvoiceId) {
      const original = await this.invoiceRepo.findOne({
        where: { id: invoice.originalInvoiceId, organizationId: invoice.organizationId },
        select: ['id', 'ncfNumber', 'issueDate'],
      });
      if (original?.ncfNumber) {
        ctx.modifica = {
          eNCFModificado: original.ncfNumber,
          fechaEmisionModificado: this.toDgiiDate(original.issueDate),
          // The reason the note was issued, recorded on the document — not a fixed '3'.
          codigoModificacion: invoice.modificationCode ?? '3',
        };
      }
    }

    return ctx;
  }

  /** How the document was settled, as the DGII's `TablaFormasPago` expects it. */
  private buildFormasPago(invoice: Invoice): EcfFormaPago[] {
    return [{ forma: paymentFormCode(invoice.paymentMethod), monto: Number(invoice.total) || 0 }];
  }

  private buildQrUrl(
    ctx: EcfBuildContext,
    securityCode: string,
    fechaHoraFirma: string,
    montoTotal: number,
  ): string {
    const endpoints = this.dgiiConfig.endpoints;
    const base = ctx.tipoECF === '32' ? endpoints.timbreConsumo : endpoints.timbre;

    // Built by hand rather than with URLSearchParams: that encodes a space as `+`, and the DGII's
    // timbre lookup expects the percent-encoded form in `FechaFirma`.
    const params: Array<[string, string]> = [['RncEmisor', ctx.emisor.rnc]];
    if (ctx.comprador?.rnc) params.push(['RncComprador', ctx.comprador.rnc]);
    params.push(['ENCF', ctx.eNCF]);
    params.push(['FechaEmision', ctx.fechaEmision]);
    params.push(['MontoTotal', montoTotal.toFixed(2)]);
    params.push(['FechaFirma', fechaHoraFirma]);
    params.push(['CodigoSeguridad', securityCode]);

    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `${base}?${query}`;
  }

  private taxIdDigits(value: string | null | undefined): string | undefined {
    const digits = (value ?? '').replace(/\D/g, '');
    return digits.length > 0 ? digits : undefined;
  }

  private toDgiiDate(isoDate: string): string {
    // 'YYYY-MM-DD' (or ISO datetime) -> 'DD-MM-YYYY'.
    const datePart = (isoDate || '').split('T')[0];
    const [y, m, d] = datePart.split('-');
    if (!y || !m || !d) return datePart;
    return `${d}-${m}-${y}`;
  }

  /**
   * `FechaHoraFirma`, in the ISSUER's time zone rather than the server's.
   *
   * This read the container clock, which is UTC. Santo Domingo is four hours behind it, so a sale
   * made after 20:00 was signed with tomorrow's date — a `FechaHoraFirma` later than the
   * comprobante's own `FechaEmision`, which the DGII rejects.
   */
  private stampNow(org: Organization): string {
    return dgiiTimestamp(organizationTimeZone(org));
  }
}
