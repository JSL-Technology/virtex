import { Injectable } from '@nestjs/common';
import {
  FiscalAdapter,
  FiscalAssignmentContext,
  FiscalDocumentTypeOption,
  FiscalNumberAssignment,
  EmissionKind,
  LiveTypesContext,
} from '../interfaces/fiscal-adapter.interface';
import { Invoice } from '../entities/invoice.entity';
import { ComplianceService } from '../../compliance/compliance.service';
import {
  CREDIT_NOTE_NCF_TYPES,
  NcfSequence,
  NcfType,
  SALES_NCF_TYPES,
} from '../../compliance/entities/ncf-sequence.entity';
import { validateTaxId } from '../../localization/contracts/tax-id.contract';
import { fiscalDocumentTypesFor } from '../../localization/contracts/fiscal-document-types.contract';

/** The Dominican catalogue by code: what each type requires of the buyer. */
const DOMINICAN_TYPES = new Map(fiscalDocumentTypesFor('DO').map((spec) => [spec.code, spec]));
import { BadRequestError } from '../../i18n/localized.exception';

/**
 * Dominican Republic fiscal numbering (DGII).
 *
 * ## What was wrong with the previous rule
 *
 * ```ts
 * const type = rnc.length === 9 ? NcfType.E31 : NcfType.E32;
 * ```
 *
 * Three separate defects in one line:
 *
 * 1. **Nine digits is not a valid RNC.** The identifier was never checked against its check digit,
 *    so any nine digits produced a Factura de Crédito Fiscal that the DGII then rejected. The
 *    algorithm exists in `tax-id-validators.ts`, with tests, and was simply not called here.
 * 2. **An eleven-digit cédula belongs to a taxpayer too.** A registered sole trader invoiced with a
 *    cédula got a consumo comprobante, which denies them the tax credit they are entitled to.
 * 3. **No other type could ever be issued.** Exports (E46), government sales (E45) and special
 *    regimes (E44) were unreachable, and the caller had no way to ask for one.
 *
 * The rule now: honour an explicitly requested type when the tenant holds a range for it; otherwise
 * issue crédito fiscal when the buyer carries a VALID Dominican taxpayer identifier, and consumo
 * when they do not — in the kind the caller chose: traditional (B01/B02) or electronic
 * (E31/E32). It used to be electronic always, so a company issuing traditional NCF had to pick the
 * type by hand on every invoice.
 */
@Injectable()
export class DominicanRepublicFiscalAdapter implements FiscalAdapter {
  constructor(private readonly complianceService: ComplianceService) {}

  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return SALES_NCF_TYPES.map((code) => ({
      code,
      labelKey: `fiscal.do.${code}`,
      // From the catalogue: crédito fiscal, gubernamental and regímenes especiales, in either
      // series. It used to be `code === E31`, so a B01 without an RNC was issued and rejected later.
      requiresBuyerTaxId: DOMINICAN_TYPES.get(code)?.requiresBuyerTaxId ?? false,
      electronic: DOMINICAN_TYPES.get(code)?.isElectronic ?? false,
    }));
  }

  /** The types with a live DGII range: active, numbers left, not expired. */
  async liveTypes({ organizationId, codes, today, manager }: LiveTypesContext): Promise<ReadonlySet<string>> {
    if (!codes.length) return new Set();
    const rows: Array<{ type: string }> = await manager
      .getRepository(NcfSequence)
      .createQueryBuilder('seq')
      .select('DISTINCT seq.type', 'type')
      .where('seq.organizationId = :organizationId', { organizationId })
      .andWhere('seq.isActive = true')
      .andWhere('seq.type IN (:...codes)', { codes: [...codes] })
      .andWhere('seq.currentSequence < seq.endsAt')
      .andWhere('(seq.expiresAt IS NULL OR seq.expiresAt >= :today)', { today })
      .getRawMany();
    return new Set(rows.map((row) => row.type));
  }

  /** Crédito fiscal or consumo, in the kind asked for: what `inferSalesType` picks from. */
  automaticTypes(kind: EmissionKind): readonly string[] {
    return kind === 'TRADITIONAL' ? [NcfType.B01, NcfType.B02] : [NcfType.E31, NcfType.E32];
  }

  async assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    const { invoice, organizationId, manager } = context;

    const requestedType = this.asNcfType(context.requestedType);
    const type = requestedType ?? this.inferSalesType(invoice, context.emissionKind ?? 'ELECTRONIC');
    if (!SALES_NCF_TYPES.includes(type)) {
      throw new BadRequestError('invoices.document_type_type_not_sales_document', { type });
    }
    if (DOMINICAN_TYPES.get(type)?.requiresBuyerTaxId && !this.hasValidDominicanTaxId(invoice)) {
      // A catalogue key, not a Spanish sentence. This was the one literal left in the adapter, so
      // an English-speaking controller in a Dominican tenant met a paragraph of Spanish at the
      // exact moment an invoice would not issue.
      throw new BadRequestError('invoices.credit_invoice_requires_buyer_tax_id');
    }

    const assigned = await this.complianceService.getNextNcf(organizationId, type, manager);
    return { ncf: assigned.ncf, documentType: assigned.type, expiresAt: assigned.expiresAt };
  }

  async assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment> {
    const { organizationId, manager, originalInvoice } = context;

    // A note must be drawn from the series that matches the document it modifies: an electronic
    // invoice is credited electronically (E34), a pre-printed one on paper (B04).
    const inferred = originalInvoice.fiscalNumber?.toUpperCase().startsWith('B')
      ? NcfType.B04
      : NcfType.E34;
    const type = this.asNcfType(context.requestedType) ?? inferred;

    if (!CREDIT_NOTE_NCF_TYPES.includes(type)) {
      throw new BadRequestError('invoices.type_type_not_valid_credit_note', { type });
    }

    const assigned = await this.complianceService.getNextNcf(organizationId, type, manager);
    return { ncf: assigned.ncf, documentType: assigned.type, expiresAt: assigned.expiresAt };
  }

  /**
   * The requested code as an `NcfType`, or a refusal.
   *
   * The context now carries the authority's own code as a string, because six other markets have
   * document types that are not Dominican. Narrowing it here rather than trusting the cast is what
   * keeps a code from another regime — a Chilean `33`, say — from reaching `getNextNcf` and being
   * looked up as a Dominican range that cannot exist.
   */
  private asNcfType(requested: string | null | undefined): NcfType | null {
    if (!requested) return null;
    const code = requested.toUpperCase();
    const known = (Object.values(NcfType) as string[]).includes(code);
    if (!known) {
      throw new BadRequestError('invoices.document_type_type_not_sales_document', {
        type: requested,
      });
    }
    return code as NcfType;
  }

  /** Crédito fiscal for a verified taxpayer, consumo otherwise — in the kind asked for. */
  private inferSalesType(invoice: Invoice, kind: EmissionKind): NcfType {
    const taxpayer = this.hasValidDominicanTaxId(invoice);
    if (kind === 'TRADITIONAL') return taxpayer ? NcfType.B01 : NcfType.B02;
    return taxpayer ? NcfType.E31 : NcfType.E32;
  }

  /**
   * A Dominican RNC (9 digits) or cédula (11 digits) that passes its own check digit.
   *
   * Both entitle the holder to the ITBIS credit, so both warrant an E31; what does not is a number
   * of the right length that no taxpayer holds.
   */
  private hasValidDominicanTaxId(invoice: Invoice): boolean {
    const raw = invoice.customerTaxId ?? invoice.customer?.taxId ?? '';
    const digits = raw.replace(/\D/g, '');
    if (digits.length !== 9 && digits.length !== 11) return false;
    return validateTaxId('DO', digits);
  }
}
