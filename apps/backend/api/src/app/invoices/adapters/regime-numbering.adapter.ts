import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  FiscalAdapter,
  FiscalAssignmentContext,
  FiscalDocumentTypeOption,
  FiscalNumberAssignment,
} from '../interfaces/fiscal-adapter.interface';
import { Invoice, InvoiceType } from '../entities/invoice.entity';
import { FiscalRangeService } from '../../einvoicing/services/fiscal-range.service';
import { FiscalRegimeSettings } from '../../einvoicing/entities/fiscal-regime-settings.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { fiscalDate, organizationTimeZone } from '../../shared/fiscal-clock';
import { BadRequestError } from '../../i18n/localized.exception';
import { SiiBuilder } from '../../einvoicing/regimes/cl/sii.builder';
import { SunatBuilder } from '../../einvoicing/regimes/pe/sunat.builder';
import { SriBuilder } from '../../einvoicing/regimes/ec/sri.builder';
import { DianBuilder } from '../../einvoicing/regimes/co/dian.builder';
import { NfeBuilder } from '../../einvoicing/regimes/br/nfe.builder';
import { CfdiBuilder } from '../../einvoicing/regimes/mx/cfdi.builder';
import { FiscalRangeSecretKind } from '../../einvoicing/entities/fiscal-document-range.entity';

/**
 * Fiscal numbering for the six markets besides the Dominican Republic whose regimes this product
 * implements.
 *
 * ## What "numbering" means in each of them, and why it is not one rule
 *
 * The Dominican adapter draws an NCF from a DGII range and that is the whole story. Elsewhere:
 *
 * - **Colombia, Peru, Ecuador, Chile, Brazil** — the authority grants a range and the taxpayer
 *   numbers within it. Same shape as the DGII, different formatting: `SETP990000001` in Colombia,
 *   `F001-00000123` in Peru, `001-001-000000123` in Ecuador, a bare folio in Chile, a bare `nNF`
 *   in Brazil.
 * - **Mexico** — there is **no fiscal number to assign**. The comprobante's identity is the UUID
 *   the PAC writes on stamping, and the `Folio` is the taxpayer's own reference with no fiscal
 *   force. Returning `ncf: null` here is correct, and it is a different fact from the generic
 *   adapter's null: the document type is recorded, and the document will be stamped.
 * - **Argentina** — AFIP assigns the number. `FECAESolicitar` is told which number is being
 *   requested and refuses anything that is not the next one for that point of sale, so the number
 *   comes from AFIP's own `FECompUltimoAutorizado` at transmission time, not from a stored range.
 *   Storing a counter here would be a second source of truth that drifts the first time a document
 *   is rejected.
 *
 * ## Where the document type comes from
 *
 * Each regime's builder owns that rule, and this asks it rather than repeating it. In Chile the
 * type depends on whether the document bears VAT (33 afecta / 34 exenta); in Peru on the series
 * letter; in Argentina on both parties' VAT condition. A second copy of any of those rules is how
 * a document gets numbered from one range and built as another.
 */
abstract class RegimeNumberingAdapter implements FiscalAdapter {
  protected constructor(
    protected readonly ranges: FiscalRangeService,
    /** ISO 3166-1 alpha-2 of the market this numbers. */
    readonly countryCode: string,
  ) {}

  abstract availableSalesTypes(): readonly FiscalDocumentTypeOption[];

  /** The type this invoice is, per the regime's own rule. */
  protected abstract typeOf(context: FiscalAssignmentContext, settings: FiscalRegimeSettings | null): string;

  /** The series the number is drawn within, or `undefined` where the market has none. */
  protected seriesOf(_settings: FiscalRegimeSettings | null): string | undefined {
    return undefined;
  }

  /** How the market writes the drawn number on the document. */
  protected abstract format(
    number: number,
    series: string,
    settings: FiscalRegimeSettings | null,
  ): string;

  async assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    return this.assign(context);
  }

  async assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment> {
    return this.assign(context);
  }

  private async assign(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    const { organizationId, manager } = context;
    const settings = await this.settings(manager, organizationId);
    this.assertKnownType(context.requestedType);
    const type = this.typeOf(context, settings);

    const drawn = await this.ranges.drawNext(manager, {
      organizationId,
      countryCode: this.countryCode,
      documentType: type,
      series: this.seriesOf(settings),
      today: await this.today(manager, organizationId),
    });

    return {
      ncf: this.format(drawn.number, drawn.series, settings),
      documentType: drawn.documentType,
      expiresAt: drawn.validUntil,
    };
  }

  /** A requested type must at least be one this market issues. */
  protected assertKnownType(requested: string | null | undefined): void {
    if (!requested) return;
    if (!this.availableSalesTypes().some((option) => option.code === requested)) {
      throw new BadRequestError('INVOICES.TIPO_COMPROBANTE_NO_PERTENECE_AL_MERCADO', {
        type: requested,
        country: this.countryCode,
      });
    }
  }

  /**
   * A requested type that contradicts what the document is, refused.
   *
   * For most of these regimes the type is not a choice: a Chilean 33 on an exempt sale, or an
   * invoice type on a credit note, is a document the authority rejects. Silently issuing the
   * correct one instead would hand back a number drawn from a range the caller did not ask for,
   * so the contradiction is named rather than resolved.
   *
   * Peru is the exception and overrides this: a boleta may legitimately be issued to a buyer who
   * holds a RUC, so there the request is honoured.
   */
  protected assertTypeMatchesDocument(requested: string | null | undefined, resolved: string): void {
    if (requested && requested !== resolved) {
      throw new BadRequestError('INVOICES.TIPO_COMPROBANTE_NO_CORRESPONDE_AL_DOCUMENTO', {
        requested,
        resolved,
      });
    }
  }

  protected async settings(
    manager: EntityManager,
    organizationId: string,
  ): Promise<FiscalRegimeSettings | null> {
    return manager.findOne(FiscalRegimeSettings, {
      where: { organizationId, countryCode: this.countryCode },
    });
  }

  /**
   * Today as the TENANT's authority reads it.
   *
   * Not `new Date()`: a Chilean tenant invoicing at 21:00 local is already on the next UTC day, and
   * a range that expires today would refuse a document that is validly dated today in Santiago.
   */
  protected async today(manager: EntityManager, organizationId: string): Promise<string> {
    const organization = await manager.findOne(Organization, {
      where: { id: organizationId },
      select: ['id', 'country', 'timezone'],
    });
    return fiscalDate(organizationTimeZone(organization ?? null));
  }
}

/**
 * Colombia — DIAN.
 *
 * The number is the resolution's prefix plus a consecutive within the authorised range, written
 * without a separator: `SETP990000001`. The prefix is the series on the range because the DIAN
 * grants prefix and range together in one resolution.
 */
@Injectable()
export class ColombiaNumberingAdapter extends RegimeNumberingAdapter {
  private readonly builder = new DianBuilder();

  constructor(ranges: FiscalRangeService) {
    super(ranges, 'CO');
  }

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [
      { code: '01', labelKey: 'FISCAL.CO.01', requiresBuyerTaxId: true },
      { code: '91', labelKey: 'FISCAL.CO.91', requiresBuyerTaxId: true },
    ];
  }

  protected typeOf(context: FiscalAssignmentContext): string {
    const resolved = this.builder.documentType(context.invoice);
    this.assertTypeMatchesDocument(context.requestedType, resolved);
    return resolved;
  }

  protected format(number: number, series: string): string {
    // The DIAN pads the consecutive to the width of the authorised range's upper bound, and the
    // range is what the resolution states; a prefix with no padding is still a valid consecutive.
    return `${series}${number}`;
  }
}

/**
 * Peru — SUNAT.
 *
 * `F001-00000123`. The series letter decides the document type — `F` factura, `B` boleta — so the
 * type cannot be resolved without knowing which series the tenant is issuing from, and the tenant's
 * configured series is what says.
 */
@Injectable()
export class PeruNumberingAdapter extends RegimeNumberingAdapter {
  private readonly builder = new SunatBuilder();

  constructor(ranges: FiscalRangeService) {
    super(ranges, 'PE');
  }

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [
      // A factura is issued to a taxpayer with a RUC and grants the IGV credit; a boleta is not.
      { code: '01', labelKey: 'FISCAL.PE.01', requiresBuyerTaxId: true },
      { code: '03', labelKey: 'FISCAL.PE.03', requiresBuyerTaxId: false },
      { code: '07', labelKey: 'FISCAL.PE.07', requiresBuyerTaxId: true },
    ];
  }

  /**
   * Factura, boleta or credit note.
   *
   * The only regime here where the type is partly the tenant's to choose: SUNAT permits a boleta to
   * any buyer, including one who holds a RUC, so an explicit request is honoured. Absent one, a
   * buyer with an eleven-digit RUC gets a factura — which is what grants them the IGV credit — and
   * anybody else a boleta. A credit note is `07` regardless.
   *
   * The series is not consulted: it comes from the range authorised for the type this resolves to,
   * and the builder's own rule (an `F` series is a factura, a `B` series a boleta) then reproduces
   * the same answer from that series. Reading the series to decide the type and then drawing from
   * the type's range would be circular.
   */
  protected typeOf(context: FiscalAssignmentContext): string {
    if (context.invoice.type === InvoiceType.CREDIT_NOTE) return '07';
    if (context.requestedType) return context.requestedType;
    return this.hasRuc(context.invoice) ? '01' : '03';
  }

  /** An eleven-digit RUC. SUNAT's own length check, and the one that separates the two documents. */
  private hasRuc(invoice: Invoice): boolean {
    const digits = (invoice.customerTaxId ?? invoice.customer?.taxId ?? '').replace(/\D/g, '');
    return digits.length === 11;
  }

  protected format(number: number, series: string): string {
    return `${series}-${String(number).padStart(8, '0')}`;
  }
}

/**
 * Ecuador — SRI.
 *
 * `001-001-000000123`: establishment, emission point, and a nine-digit sequential. The first two
 * are the tenant's configuration, not the range's, because the SRI authorises the emission point
 * and the taxpayer numbers freely within it.
 */
@Injectable()
export class EcuadorNumberingAdapter extends RegimeNumberingAdapter {
  private readonly builder = new SriBuilder();

  constructor(ranges: FiscalRangeService) {
    super(ranges, 'EC');
  }

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [
      { code: '01', labelKey: 'FISCAL.EC.01', requiresBuyerTaxId: false },
      { code: '04', labelKey: 'FISCAL.EC.04', requiresBuyerTaxId: false },
    ];
  }

  protected typeOf(context: FiscalAssignmentContext): string {
    const resolved = this.builder.documentType(context.invoice);
    this.assertTypeMatchesDocument(context.requestedType, resolved);
    return resolved;
  }

  protected format(number: number, _series: string, settings: FiscalRegimeSettings | null): string {
    const establishment = (settings?.establishment ?? '').padStart(3, '0').slice(0, 3);
    const emissionPoint = (settings?.emissionPoint ?? '').padStart(3, '0').slice(0, 3);
    if (!settings?.establishment || !settings?.emissionPoint) {
      throw new BadRequestError('EINVOICING.SRI_FALTA_ESTABLECIMIENTO_PUNTO_EMISION');
    }
    return `${establishment}-${emissionPoint}-${String(number).padStart(9, '0')}`;
  }
}

/**
 * Chile — SII.
 *
 * The folio is the number, written bare. Its range is a CAF, which also carries the RSA key that
 * seals the document's timbre — so the range this draws from is the same row the regime adapter
 * later reads the key out of, and a folio from one CAF sealed with another's key is rejected.
 */
@Injectable()
export class ChileNumberingAdapter extends RegimeNumberingAdapter {
  private readonly builder = new SiiBuilder();

  constructor(ranges: FiscalRangeService) {
    super(ranges, 'CL');
  }

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [
      { code: '33', labelKey: 'FISCAL.CL.33', requiresBuyerTaxId: true },
      { code: '34', labelKey: 'FISCAL.CL.34', requiresBuyerTaxId: true },
      { code: '61', labelKey: 'FISCAL.CL.61', requiresBuyerTaxId: true },
    ];
  }

  protected typeOf(context: FiscalAssignmentContext): string {
    // 33 afecta / 34 exenta is decided by whether the sale bears VAT, never by the caller: the SII
    // rejects an exempt sale issued on an afecta folio, and both are drawn from different CAFs.
    const resolved = this.builder.documentType(context.invoice);
    this.assertTypeMatchesDocument(context.requestedType, resolved);
    return resolved;
  }

  protected format(number: number): string {
    return String(number);
  }
}

/**
 * Brazil — SEFAZ.
 *
 * The `nNF` is the number, bare, within a série the establishment runs. The série is the range's
 * own, because a taxpayer with two establishments runs two séries and each numbers independently.
 */
@Injectable()
export class BrazilNumberingAdapter extends RegimeNumberingAdapter {
  private readonly builder = new NfeBuilder();

  constructor(ranges: FiscalRangeService) {
    super(ranges, 'BR');
  }

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [{ code: '55', labelKey: 'FISCAL.BR.55', requiresBuyerTaxId: true }];
  }

  protected typeOf(): string {
    return this.builder.documentType();
  }

  protected format(number: number): string {
    return String(number);
  }
}

/**
 * Mexico — SAT, through a PAC.
 *
 * Assigns no fiscal number, and that is not a gap: a CFDI's fiscal identity is the UUID the PAC
 * writes when it stamps, and the `Folio` is the taxpayer's own reference with no fiscal force. What
 * this does record is the `TipoDeComprobante`, so the document knows what it is before it is built.
 *
 * The tenant's own document number (`document_sequences`) still fills the `Folio`.
 */
@Injectable()
export class MexicoNumberingAdapter implements FiscalAdapter {
  readonly countryCode = 'MX';
  private readonly builder = new CfdiBuilder();

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [
      { code: 'I', labelKey: 'FISCAL.MX.I', requiresBuyerTaxId: true },
      { code: 'E', labelKey: 'FISCAL.MX.E', requiresBuyerTaxId: true },
    ];
  }

  async assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    return {
      ncf: null,
      documentType: this.builder.documentType(context.invoice),
      expiresAt: null,
    };
  }

  async assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment> {
    return {
      ncf: null,
      documentType: this.builder.documentType(context.invoice),
      expiresAt: null,
    };
  }
}

/**
 * Argentina — AFIP.
 *
 * AFIP assigns the number. `FECAESolicitar` states which number is being requested and refuses
 * anything that is not the next one for that point of sale and document type, so the authoritative
 * counter lives at AFIP and is read with `FECompUltimoAutorizado` at transmission time.
 *
 * A stored range here would be a second source of truth, and it would drift the first time AFIP
 * rejected a document: our counter would have advanced and AFIP's would not, and every subsequent
 * request would be refused for a number gap until someone reconciled them by hand. So this assigns
 * no number, and the regime adapter fills it from AFIP's own answer along with the CAE.
 */
@Injectable()
export class ArgentinaNumberingAdapter implements FiscalAdapter {
  readonly countryCode = 'AR';

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [
      { code: '01', labelKey: 'FISCAL.AR.01', requiresBuyerTaxId: true },
      { code: '06', labelKey: 'FISCAL.AR.06', requiresBuyerTaxId: false },
      { code: '11', labelKey: 'FISCAL.AR.11', requiresBuyerTaxId: false },
    ];
  }

  async assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    return { ncf: null, documentType: this.typeFor(context.invoice), expiresAt: null };
  }

  async assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment> {
    return { ncf: null, documentType: this.typeFor(context.invoice), expiresAt: null };
  }

  /**
   * Recorded provisionally, and settled at transmission.
   *
   * The letter — A, B or C — depends on the seller's VAT condition and the buyer's, and the second
   * is only fully known once the customer's identifier is resolved against AFIP's padrón. The
   * builder decides it with both parties in hand; here the document is only being marked as a
   * credit note or not, which is the part that cannot change.
   */
  private typeFor(invoice: Invoice): string {
    return invoice.type === InvoiceType.CREDIT_NOTE ? '03' : '01';
  }
}

export { FiscalRangeSecretKind };
