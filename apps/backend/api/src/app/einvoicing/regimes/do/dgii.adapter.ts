import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { certificateRegimeFor } from '../../contracts/certificate-policy';
import { adjustmentCodeFor } from '../../../markets';
import { Invoice, InvoiceType, PaymentMethod } from '../../../invoices/entities/invoice.entity';
import { TaxTreatment } from '../../../invoices/entities/invoice-line-item.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../../organizations/entities/organization-settings.entity';
import { SigningCertificate } from '../../entities/signing-certificate.entity';
import { CertificateVaultService, LoadedCertificate } from '../../services/certificate-vault.service';
import { DgiiAuthService } from './dgii-auth.service';
import { DgiiConfigService } from './dgii-config.service';
import { DgiiDocumentEventsService } from './dgii-document-events.service';
import { DgiiTransportService } from './dgii-transport.service';
import { EcfSignerService } from './ecf-signer.service';
import { EcfValidatorService } from './ecf-validator.service';
import {
  EcfBuildContext,
  EcfFormaPago,
  EcfItemInput,
  EcfXmlBuilderService,
} from './ecf-xml-builder.service';
import {
  incomeTypeCode,
  municipalityCode,
  paymentFormCode,
  provinceCode,
  unitOfMeasureCode,
} from './dgii-catalogues';
import { statutoryTaxRatesOn } from '../../../localization/contracts/statutory-tax-rates.contract';
import { dayFirstTimestamp, organizationTimeZone } from '../../../shared/fiscal-clock';
import { BadRequestError } from '../../../i18n/localized.exception';
import {
  FiscalRegimeAdapter,
  FiscalRegimeContext,
  FiscalTransmissionResult,
  RegimeNotConfigured,
  SealedFiscalDocument,
} from '../fiscal-regime.types';
import { dgiiVerdict } from './dgii-estado';

/**
 * Dominican Republic — DGII e-CF.
 *
 * ## Why this adapter exists
 *
 * The Dominican regime predates the `FiscalRegimeAdapter` interface and ran on a pipeline of its
 * own: its own table (`ecf_submissions`), its own orchestrator (`EcfSubmissionService`), its own
 * reconciler, its own statuses. Six other regimes then grew against the interface, so the product
 * had two pipelines doing the same four things — build, seal, transmit, reconcile — and every
 * question about "where does a document stand with its authority" had two answers depending on the
 * country. One of them, the Dominican one, is the one that works, which is why the interface was
 * kept away from it for as long as the six were unproven.
 *
 * They are proven now, so the DGII regime becomes an adapter like the others. The parts that were
 * genuinely Dominican — the XML in the DGII's schema, the XMLDSig profile, the reception and status
 * services, the código de seguridad, the QR of the representación impresa — are all still here, in
 * this file and the services it calls. What is gone is the second pipeline around them.
 *
 * ## What the DGII does that the interface had to learn
 *
 * - **A third verdict.** «Aceptado Condicional» is neither acceptance nor rejection: the document
 *   stands and carries observations the taxpayer must read.
 * - **Contingency.** A sale does not wait for the DGII to come back up. The comprobante is issued,
 *   the number is spent, and the document is owed — retried, never silently dropped.
 * - **Asking before resending.** After a dropped connection the DGII may already hold the
 *   comprobante. From the second attempt on, this asks (`queryTrackIds`) and adopts what it finds,
 *   because transmitting twice is how one sale ends with two fiscal documents.
 */
@Injectable()
export class DgiiRegimeAdapter implements FiscalRegimeAdapter {
  readonly countryCode = 'DO';
  readonly regime = 'DGII e-CF';

  private readonly logger = new Logger(DgiiRegimeAdapter.name);

  constructor(
    private readonly vault: CertificateVaultService,
    private readonly signer: EcfSignerService,
    private readonly builder: EcfXmlBuilderService,
    private readonly validator: EcfValidatorService,
    private readonly auth: DgiiAuthService,
    private readonly transport: DgiiTransportService,
    private readonly dgiiConfig: DgiiConfigService,
    /**
     * What the DGII receives ABOUT documents: the buyer's verdict on a comprobante and the
     * annulment of authorised numbers. The door reaches it through this adapter, so it names no
     * Dominican service of its own.
     */
    readonly documentEvents: DgiiDocumentEventsService,
  ) {}

  /**
   * The comprobante in the DGII's schema, checked against its rules before a signature is spent on
   * a document reception would refuse.
   */
  async build(context: FiscalRegimeContext): Promise<SealedFiscalDocument> {
    const organization = await this.organizationOf(context);
    const ctx = await this.buildContext(context, organization);
    const montoTotal = this.builder.montoTotal(ctx);
    // The ITBIS rates are the ones in force on the document's own date (SP-03).
    const [day, month, year] = ctx.fechaEmision.split('-');
    const rates = (await statutoryTaxRatesOn(context.manager, 'DO', `${year}-${month}-${day}`)) ?? [];
    this.validator.assertValid(ctx, montoTotal, rates);

    return {
      payload: this.builder.build(ctx),
      contentType: 'application/xml',
      // Derived from the signature, so it is only knowable once the document is sealed.
      documentKey: null,
    };
  }

  /** The tenant's active DGII certificate, decrypted for the length of one signature. */
  async loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate> {
    const stored = await context.manager.findOne(SigningCertificate, {
      where: {
        organizationId: context.organizationId,
        regime: certificateRegimeFor(this.countryCode),
        isActive: true,
      },
      order: { createdAt: 'DESC' },
    });
    if (!stored) throw new RegimeNotConfigured(this.regime, 'tu certificado digital de la DGII');
    if (stored.notAfter && stored.notAfter.getTime() < Date.now()) {
      throw new BadRequestError('einvoicing.certificate.expired', {
        expiredOn: stored.notAfter.toISOString().split('T')[0],
      });
    }
    return this.vault.load(stored);
  }

  /**
   * XMLDSig over the whole comprobante, then the código de seguridad and the QR of the
   * representación impresa.
   *
   * The QR's parameters are read back out of the SIGNED document rather than recomputed: what the
   * DGII's portal resolves has to be what was transmitted, down to the total and the signing
   * timestamp, and a second computation is a second chance to disagree with the first.
   */
  async seal(
    document: SealedFiscalDocument,
    certificate: LoadedCertificate,
    context: FiscalRegimeContext,
  ): Promise<SealedFiscalDocument> {
    const payload = this.signer.sign(document.payload, certificate, 'ECF');
    const securityCode = this.signer.securityCode(payload);
    return {
      ...document,
      payload,
      documentKey: securityCode,
      verificationUrl: await this.timbreUrl(context.organizationId, payload, securityCode),
    };
  }

  /**
   * Transmit it, and say what the DGII answered.
   *
   * An outage is `CONTINGENCY`: the comprobante is issued and owed, not failed. A 4xx is the
   * DGII's verdict about the document and the transport already surfaces it as `Rechazado`, so it
   * is recorded as a rejection instead of being retried forever.
   */
  async transmit(
    document: SealedFiscalDocument,
    context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult> {
    const organization = await this.organizationOf(context);
    const eNcf = context.invoice.fiscalNumber as string;
    const certificate = await this.loadCertificate(context);
    let token: string;
    try {
      token = await this.auth.getToken(context.organizationId, certificate);
    } catch (error) {
      return this.contingency(error, eNcf);
    }

    const adopted = await this.adoptExistingTrackId(context, token, organization.taxId ?? '', eNcf);
    if (adopted) return adopted;

    try {
      const result = await this.transport.sendEcf(
        context.organizationId,
        token,
        document.payload,
        eNcf,
        this.typeOf(context.invoice),
      );
      return {
        status: dgiiVerdict(result.estado),
        trackingId: result.trackId ?? null,
        messages: result.mensajes ?? [],
        raw: result.raw,
      };
    } catch (error) {
      return this.contingency(error, eNcf);
    }
  }

  /** Ask the DGII for the verdict of a comprobante it received. */
  async checkStatus(trackingId: string, context: FiscalRegimeContext): Promise<FiscalTransmissionResult> {
    const certificate = await this.loadCertificate(context);
    const token = await this.auth.getToken(context.organizationId, certificate);
    const status = await this.transport.queryStatus(context.organizationId, token, trackingId);
    return {
      status: dgiiVerdict(status.estado),
      trackingId,
      messages: status.mensajes ?? [],
      raw: status.raw,
    };
  }

  /**
   * The DGII's channel is the taxpayer's certificate: the endpoints are published by the authority
   * and resolved from the regime's environment, and the token is obtained with that certificate.
   * There is nothing else for the tenant to configure, so asking for a configured endpoint — as
   * the regimes with a PAC or a SOAP service must — would block every Dominican e-CF.
   */
  async isTransmissionConfigured(context: Pick<FiscalRegimeContext, 'organizationId' | 'manager'>): Promise<boolean> {
    const certificate = await context.manager.findOne(SigningCertificate, {
      where: {
        organizationId: context.organizationId,
        regime: certificateRegimeFor(this.countryCode),
        isActive: true,
      },
    });
    return Boolean(certificate);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /**
   * Ask the DGII whether it already holds this e-NCF before sending it again.
   *
   * Best-effort: if the lookup itself fails we proceed to send, because refusing to transmit is
   * worse than a duplicate the DGII will refuse.
   */
  private async adoptExistingTrackId(
    context: FiscalRegimeContext,
    token: string,
    taxId: string,
    eNcf: string,
  ): Promise<FiscalTransmissionResult | null> {
    if (context.attempt <= 1) return null;
    try {
      const entries = await this.transport.queryTrackIds(
        context.organizationId,
        token,
        taxId.replace(/\D/g, ''),
        eNcf,
      );
      const existing = entries[0];
      if (!existing) return null;
      this.logger.log(`e-CF ${eNcf}: trackId existente ${existing.trackId} adoptado.`);
      return {
        status: dgiiVerdict(existing.estado),
        trackingId: existing.trackId,
        messages: [
          `La DGII ya había recibido este e-NCF (trackId ${existing.trackId}); se adoptó en lugar de retransmitir.`,
        ],
        raw: existing,
      };
    } catch {
      return null;
    }
  }

  /** The DGII could not be reached: the comprobante is issued and owed, not failed. */
  private contingency(error: unknown, eNcf: string): FiscalTransmissionResult {
    const message = error instanceof ServiceUnavailableException ? error.message : (error as Error)?.message ?? String(error);
    this.logger.warn(`e-CF ${eNcf} en contingencia: ${message}`);
    return { status: 'CONTINGENCY', messages: [message], raw: null };
  }

  /** The DGII's type code, as it was drawn (`invoices.fiscal_document_type`: `E31` → `31`). */
  private typeOf(invoice: Invoice): string {
    const declared = (invoice.fiscalDocumentType ?? '').toUpperCase();
    if (/^E\d{2}$/.test(declared)) return declared.slice(1);
    return (invoice.fiscalNumber ?? '').substring(1, 3);
  }

  private async organizationOf(context: FiscalRegimeContext): Promise<Organization> {
    const organization = await context.manager.findOne(Organization, { where: { id: context.organizationId } });
    if (!organization) throw new BadRequestError('einvoicing.do.organization_not_found');
    if (!organization.taxId) {
      throw new BadRequestError('einvoicing.certificate.organization_has_no_tax_id', { label: 'RNC' });
    }
    return organization;
  }

  /**
   * The QR of the representación impresa, from the signed document's own fields.
   *
   * Built by hand rather than with URLSearchParams: that encodes a space as `+`, and the DGII's
   * timbre lookup expects the percent-encoded form in `FechaFirma`.
   */
  private async timbreUrl(organizationId: string, signedXml: string, securityCode: string): Promise<string> {
    const field = (name: string): string | null => {
      const match = new RegExp(`<${name}>([^<]*)</${name}>`).exec(signedXml);
      return match ? match[1] : null;
    };
    const type = field('TipoeCF') ?? '';
    const endpoints = await this.dgiiConfig.endpointsFor(organizationId);
    const base = type === '32' ? endpoints.timbreConsumo : endpoints.timbre;

    const params: Array<[string, string]> = [['RncEmisor', field('RNCEmisor') ?? '']];
    const buyer = field('RNCComprador');
    if (buyer) params.push(['RncComprador', buyer]);
    params.push(['ENCF', field('eNCF') ?? '']);
    params.push(['FechaEmision', field('FechaEmision') ?? '']);
    params.push(['MontoTotal', field('MontoTotal') ?? '']);
    params.push(['FechaFirma', field('FechaHoraFirma') ?? '']);
    params.push(['CodigoSeguridad', securityCode]);

    const query = params
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `${base}?${query}`;
  }

  /** The invoice as the DGII's schema describes it. */
  private async buildContext(context: FiscalRegimeContext, org: Organization): Promise<EcfBuildContext> {
    const { invoice, manager } = context;
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
        // Line discount PLUS this line's share of the document discount.
        //
        // The document discount reduces the taxable base, so the base the DGII recomputes the
        // ITBIS from has to be net of it. Declaring it as a global `DescuentoOFacturaTotal` while
        // leaving the item amounts gross makes `MontoGravadoTotal × tasa` disagree with
        // `TotalITBIS`, and reception rejects the comprobante. Carrying it per item is what makes
        // the transmitted document describe what was actually charged.
        descuentoMonto: (Number(line.discountAmount) || 0) + (Number(line.documentDiscountAmount) || 0),
        itbisTasa: Number(line.taxRate) || 0,
        exento: line.taxTreatment === TaxTreatment.EXEMPT,
        montoImpuestoSelectivo: Number(line.exciseAmount) || 0,
      }));

    const tipoECF = this.typeOf(invoice);
    const isCredit = invoice.paymentMethod === PaymentMethod.CREDIT;
    const settings = await manager.findOne(OrganizationSettings, { where: { organizationId: invoice.organizationId } });
    const baseCurrency = settings?.baseCurrency ?? 'DOP';

    const ctx: EcfBuildContext = {
      tipoECF,
      eNCF: invoice.fiscalNumber as string,
      fechaVencimientoSecuencia: invoice.fiscalNumberExpiresAt ? toDgiiDate(invoice.fiscalNumberExpiresAt) : undefined,
      tipoIngresos: incomeTypeCode(org.fiscalProfile?.['tipoIngreso']),
      tipoPago: isCredit ? '2' : '1',
      formasPago: isCredit ? undefined : formasPago(invoice),
      fechaLimitePago: isCredit ? toDgiiDate(invoice.dueDate) : undefined,
      fechaEmision: toDgiiDate(invoice.issueDate),
      // `FechaHoraFirma` in the ISSUER's time zone rather than the server's: Santo Domingo is four
      // hours behind UTC, so a sale made after 20:00 was signed with tomorrow's date — a signing
      // timestamp later than the comprobante's own `FechaEmision`, which the DGII rejects.
      fechaHoraFirma: dayFirstTimestamp(organizationTimeZone(org)),
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
        rnc: taxIdDigits(invoice.customerTaxId ?? invoice.customer?.taxId),
        razonSocial: invoice.customerName || invoice.customer?.companyName || undefined,
        direccion: invoice.customerAddress || undefined,
      },
      items,
      // Zero on purpose: the document discount is already inside each item's `descuentoMonto`
      // above, and declaring it here as well would subtract it from the total a second time.
      descuentoGlobal: 0,
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
      ctx.modifica = await this.reference(manager, invoice, org.country);
    }

    return ctx;
  }

  /** The comprobante a note modifies, with this authority's code for why it was issued. */
  private async reference(
    manager: EntityManager,
    invoice: Invoice,
    country: string | null | undefined,
  ): Promise<EcfBuildContext['modifica']> {
    const original = await manager.findOne(Invoice, {
      where: { id: invoice.originalInvoiceId as string, organizationId: invoice.organizationId },
      select: ['id', 'fiscalNumber', 'issueDate'],
    });
    if (!original?.fiscalNumber) return undefined;
    // The reason the note was issued, recorded on the document in the product's own terms, as this
    // market's authority codes it — not a fixed '3', and not a code the core stores.
    const reason = invoice.adjustmentReason ?? 'OTHER';
    const codigoModificacion = adjustmentCodeFor(
      country,
      reason,
      invoice.type === InvoiceType.DEBIT_NOTE ? 'DEBIT_NOTE' : 'CREDIT_NOTE',
    );
    if (!codigoModificacion) {
      throw new BadRequestError('einvoicing.adjustment_reason_has_no_authority_code', { reason });
    }
    return {
      eNCFModificado: original.fiscalNumber,
      fechaEmisionModificado: toDgiiDate(original.issueDate),
      codigoModificacion,
    };
  }
}

/** How the document was settled, as the DGII's `TablaFormasPago` expects it. */
function formasPago(invoice: Invoice): EcfFormaPago[] {
  return [{ forma: paymentFormCode(invoice.paymentMethod), monto: Number(invoice.total) || 0 }];
}

function taxIdDigits(value: string | null | undefined): string | undefined {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
}

/** `YYYY-MM-DD` (or an ISO datetime) as the DGII writes dates: `DD-MM-YYYY`. */
function toDgiiDate(isoDate: string): string {
  const datePart = (isoDate || '').split('T')[0];
  const [y, m, d] = datePart.split('-');
  if (!y || !m || !d) return datePart;
  return `${d}-${m}-${y}`;
}
