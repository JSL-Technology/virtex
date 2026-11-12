import { EntityManager } from 'typeorm';
import { roundToCurrency } from '../../common/money';
import { FiscalRegimeSettings } from '../../einvoicing/entities/fiscal-regime-settings.entity';
import { FiscalRangeService } from '../../einvoicing/services/fiscal-range.service';
import { BadRequestError, InternalServerError } from '../../i18n/localized.exception';
import {
  TaxpayerType,
  fiscalAuthorityOf,
  validateTaxId,
  type DocumentPurpose,
  type DocumentToNumber,
  type IssuingPoint,
  type Market,
  type MarketFiscalDocumentType,
} from '../../markets';
import { branchFiscalCodes } from '../../organizations/contracts/branch.contract';
import {
  OrganizationFiscalIdentity,
  organizationFiscalIdentity,
} from '../../organizations/contracts/fiscal-identity.contract';
import { DEFAULT_FISCAL_TIME_ZONE, fiscalDate } from '../../shared/fiscal-clock';
import { Invoice } from '../entities/invoice.entity';
import {
  FiscalAdapter,
  FiscalAssignmentContext,
  FiscalDocumentTypeOption,
  FiscalNumberAssignment,
  LiveTypesContext,
} from '../interfaces/fiscal-adapter.interface';

type NumberedPurpose = Exclude<DocumentPurpose, 'PURCHASE_RECORD'>;

/** What a document that carries no fiscal identity records. */
const NO_FISCAL_IDENTITY: FiscalNumberAssignment = { fiscalNumber: null, documentType: null, expiresAt: null, sequence: null, series: null };

/** The refusal for a requested type that is not one of the document's purpose. */
const WRONG_PURPOSE: Readonly<Record<NumberedPurpose, string>> = {
  INVOICE: 'invoices.document_type_type_not_sales_document',
  CREDIT_NOTE: 'invoices.type_type_not_valid_credit_note',
  DEBIT_NOTE: 'invoices.debit_note_type_not_valid',
};

/**
 * Numbers a market's fiscal documents by the market's own rule — the one engine for every market.
 *
 * ## What it replaces
 *
 * A `switch` on the country code chose one of nine adapters: a Dominican one drawing from its own
 * table (`ncf_sequences`), six «regime numbering» adapters drawing from `fiscal_document_ranges`
 * and asking each e-invoicing builder which type a document was, an Argentine and a Mexican one that
 * drew nothing, and a generic one for the rest. Each market was numbered by code written for it, and
 * the types each offered disagreed with the market's own catalogue (Argentina's `01` against `1`).
 *
 * Now the market declares how it numbers (`markets/<cc>/documents.ts`, `numbering`): where the
 * number comes from, which type a document is, whether the issuer may choose another, and how the
 * drawn number is written. This adapter does the rest the same way everywhere: it reads the document
 * into a neutral view, resolves the type against the market's catalogue, checks the buyer qualifies
 * for it, draws from the tenant's authorised range under a row lock, and records the sequence and
 * series it drew so nothing downstream has to parse them back out of the formatted number.
 */
export class MarketFiscalAdapter implements FiscalAdapter {
  readonly assignDebitNoteNumber?: FiscalAdapter['assignDebitNoteNumber'];
  readonly automaticTypes?: FiscalAdapter['automaticTypes'];
  readonly assignTillReceiptNumber?: FiscalAdapter['assignTillReceiptNumber'];

  constructor(
    private readonly market: Market,
    private readonly ranges: FiscalRangeService,
  ) {
    const { documents } = market;
    // A market whose regime cannot issue a debit note through the product has none to offer, and is
    // refused one before a number is drawn rather than numbering a document its authority rejects.
    if (documents.debitNotes) {
      this.assignDebitNoteNumber = (context) => this.assign(context, 'DEBIT_NOTE', context.originalInvoice);
    }
    const automatic = documents.numbering.automaticTypes;
    if (automatic) this.automaticTypes = (kind) => automatic[kind] ?? [];
    const receipt = documents.numbering.tillReceiptType;
    if (receipt) this.assignTillReceiptNumber = (context) => this.drawTillReceipt(receipt, context);
  }

  get countryCode(): string {
    return this.market.code;
  }

  /** The sale types of the market's catalogue, in the order a form offers them. */
  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [...this.market.documents.types]
      .filter((type) => type.purpose === 'INVOICE' && type.side !== 'purchase')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((type) => ({
        code: type.code,
        labelKey: type.labelKey,
        requiresBuyerTaxId: type.requiresBuyerTaxId,
        electronic: type.isElectronic,
      }));
  }

  /**
   * Of these types, the ones the company can number today. From an authorised range: an active one
   * with numbers left and not expired. From the authority itself (a stamp, AFIP's counter): every
   * type. Where the product issues no fiscal number: none.
   */
  async liveTypes({ organizationId, codes, today, manager }: LiveTypesContext): Promise<ReadonlySet<string>> {
    switch (this.market.documents.numbering.source) {
      case 'AUTHORITY_RANGE':
        return this.ranges.liveDocumentTypes(manager, { organizationId, countryCode: this.market.code, documentTypes: codes, today });
      case 'NONE':
        return new Set<string>();
      default:
        return new Set(codes);
    }
  }

  assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    return this.assign(context, 'INVOICE', null);
  }

  assignCreditNoteNumber(context: FiscalAssignmentContext & { originalInvoice: Invoice }): Promise<FiscalNumberAssignment> {
    return this.assign(context, 'CREDIT_NOTE', context.originalInvoice);
  }

  private async assign(
    context: FiscalAssignmentContext,
    purpose: NumberedPurpose,
    original: Invoice | null,
  ): Promise<FiscalNumberAssignment> {
    const numbering = this.market.documents.numbering;
    const requested = context.requestedType?.trim() ? context.requestedType.trim().toUpperCase() : null;

    if (numbering.source === 'NONE') {
      // A type asked for where the product issues none is not ignored: the caller believes it exists.
      if (requested) {
        throw new BadRequestError('invoices.document_type_type_does_not_exist', { type: requested, country: this.market.code });
      }
      return NO_FISCAL_IDENTITY;
    }

    const organization = await organizationFiscalIdentity(context.manager, context.organizationId);
    const document = this.documentToNumber(context, purpose, original, organization);
    const type = this.resolveType(document, requested);
    this.assertBuyerQualifies(type, document);

    if (numbering.source !== 'AUTHORITY_RANGE') {
      // The authority's stamp or its own counter is the document's identity; only the type is known now.
      return { fiscalNumber: null, documentType: type.code, expiresAt: null, sequence: null, series: null };
    }

    const point = await this.issuingPoint(context);
    if (numbering.issuingPointRequired && (!point.establishment || !point.emissionPoint)) {
      throw new BadRequestError('invoices.issuing_point_missing', { authority: fiscalAuthorityOf(this.market.code) });
    }
    const drawn = await this.ranges.drawNext(context.manager, {
      organizationId: context.organizationId,
      countryCode: this.market.code,
      documentType: type.code,
      series: numbering.seriesOf?.(point, document),
      today: fiscalDate(organization?.timeZone ?? DEFAULT_FISCAL_TIME_ZONE),
    });
    const sequence = { sequence: drawn.number, series: drawn.series, documentType: drawn.documentType };
    return {
      fiscalNumber: numbering.format ? numbering.format(sequence, point) : String(drawn.number),
      documentType: drawn.documentType,
      expiresAt: drawn.validUntil,
      sequence: drawn.number,
      series: drawn.series,
    };
  }

  /**
   * The type the document is issued as. A requested type must exist in the market's catalogue; where
   * the market lets the issuer choose, it must be of the document's purpose, and where the type
   * follows from the document, it must be that type — the contradiction is named, never resolved by
   * quietly issuing another.
   */
  private resolveType(document: DocumentToNumber, requested: string | null): MarketFiscalDocumentType {
    const { types, numbering } = this.market.documents;
    const resolved = numbering.typeOf(document);
    if (requested) {
      const type = types.find((candidate) => candidate.code.toUpperCase() === requested);
      if (!type) {
        throw new BadRequestError('invoices.document_type_type_does_not_exist', { type: requested, country: this.market.code });
      }
      if (numbering.requestedType === 'CONFIRM') {
        if (requested !== resolved?.toUpperCase()) {
          throw new BadRequestError('invoices.you_asked_type_requested_document_type', { requested, resolved: resolved ?? '—' });
        }
        return type;
      }
      if (type.purpose !== document.purpose || type.side === 'purchase') {
        throw new BadRequestError(WRONG_PURPOSE[document.purpose], { type: requested });
      }
      return type;
    }
    if (!resolved) {
      // The market needs a fiscal fact the company has not stated (an issuer's VAT condition).
      throw new BadRequestError('invoices.document_type_undetermined', { authority: fiscalAuthorityOf(this.market.code) });
    }
    const type = types.find((candidate) => candidate.code === resolved);
    if (!type) {
      // A policy naming a type its own catalogue lacks is a defect in the market's package.
      throw new InternalServerError('invoices.document_type_type_does_not_exist', { type: resolved, country: this.market.code });
    }
    return type;
  }

  /** A type that names the buyer for their tax credit needs a buyer the market's rule recognises. */
  private assertBuyerQualifies(type: MarketFiscalDocumentType, document: DocumentToNumber): void {
    if (!type.requiresBuyerTaxId) return;
    const taxId = (document.buyer.taxId ?? '').replace(/\s+/g, '');
    if (!validateTaxId(this.market.code, taxId)) {
      throw new BadRequestError('invoices.document_type_requires_buyer_tax_id', { type: type.code });
    }
  }

  /** The document as the market's numbering reads it: facts, not the ORM entity. */
  private documentToNumber(
    context: FiscalAssignmentContext,
    purpose: NumberedPurpose,
    original: Invoice | null,
    organization: OrganizationFiscalIdentity | null,
  ): DocumentToNumber {
    const { invoice } = context;
    const customer = invoice.customer;
    return {
      purpose,
      emissionKind: context.emissionKind ?? null,
      buyer: {
        taxId: (invoice.customerTaxId ?? customer?.taxId ?? '').trim() || null,
        documentCode: customer?.identityDocumentTypeCode ?? null,
        countryCode: customer?.country ?? null,
        taxpayerKind: !customer?.taxpayerType ? null : customer.taxpayerType === TaxpayerType.INDIVIDUAL ? 'individual' : 'company',
        // A buyer's market-specific fiscal data (a VAT condition) is not recorded on the customer yet.
        fiscalAttributes: null,
      },
      issuerFiscalProfile: organization?.fiscalProfile ?? {},
      chargesTax: roundToCurrency(Number(invoice.tax ?? 0), invoice.currencyCode ?? '') > 0,
      original: original ? { documentType: original.fiscalDocumentType ?? null, fiscalNumber: original.fiscalNumber ?? null } : null,
    };
  }

  /**
   * Where the document is issued from, for a market that numbers per establishment and emission
   * point: the issuing branch's own codes, or the company's configured ones. Read only where the
   * market numbers that way.
   */
  private async issuingPoint(context: FiscalAssignmentContext): Promise<IssuingPoint> {
    const numbering = this.market.documents.numbering;
    if (!numbering.issuingPointRequired && !numbering.seriesOf) return { establishment: null, emissionPoint: null };
    const branch = await branchFiscalCodes(context.manager, context.organizationId, context.invoice.branchId);
    if (branch) return branch;
    const settings = await context.manager.findOne(FiscalRegimeSettings, {
      where: { organizationId: context.organizationId, countryCode: this.market.code },
    });
    return { establishment: settings?.establishment ?? null, emissionPoint: settings?.emissionPoint ?? null };
  }

  /**
   * A till receipt, in a market whose consumers receive the authority's receipt from the till: drawn
   * from the company's range for the market's receipt type, and only when it holds one in force.
   */
  private async drawTillReceipt(
    type: string,
    context: { organizationId: string; today: string; manager: EntityManager },
  ): Promise<FiscalNumberAssignment | null> {
    const live = await this.ranges.liveDocumentTypes(context.manager, {
      organizationId: context.organizationId,
      countryCode: this.market.code,
      documentTypes: [type],
      today: context.today,
    });
    if (!live.has(type)) return null;
    const drawn = await this.ranges.drawNext(context.manager, {
      organizationId: context.organizationId,
      countryCode: this.market.code,
      documentType: type,
      today: context.today,
    });
    const numbering = this.market.documents.numbering;
    const point: IssuingPoint = { establishment: null, emissionPoint: null };
    const sequence = { sequence: drawn.number, series: drawn.series, documentType: drawn.documentType };
    return {
      fiscalNumber: numbering.format ? numbering.format(sequence, point) : String(drawn.number),
      documentType: drawn.documentType,
      expiresAt: drawn.validUntil,
      sequence: drawn.number,
      series: drawn.series,
    };
  }
}
