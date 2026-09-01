import { BadRequestException, Injectable } from '@nestjs/common';
import {
  FiscalAdapter,
  FiscalAssignmentContext,
  FiscalNumberAssignment,
} from '../interfaces/fiscal-adapter.interface';
import { Invoice } from '../entities/invoice.entity';
import { ComplianceService } from '../../compliance/compliance.service';
import {
  CREDIT_NOTE_NCF_TYPES,
  NcfType,
  SALES_NCF_TYPES,
} from '../../compliance/entities/ncf-sequence.entity';
import { validateTaxId } from '../../localization/fiscal/tax-id-validators';

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
 * when they do not.
 */
@Injectable()
export class DominicanRepublicFiscalAdapter implements FiscalAdapter {
  constructor(private readonly complianceService: ComplianceService) {}

  availableSalesTypes(): readonly NcfType[] {
    return SALES_NCF_TYPES;
  }

  async assignSalesNumber(context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    const { invoice, organizationId, manager, requestedType } = context;

    const type = requestedType ?? this.inferSalesType(invoice);
    if (!SALES_NCF_TYPES.includes(type)) {
      throw new BadRequestException(
        `El tipo de comprobante ${type} no corresponde a un documento de venta.`,
      );
    }
    if (type === NcfType.E31 && !this.hasValidDominicanTaxId(invoice)) {
      throw new BadRequestException(
        'Una Factura de Crédito Fiscal (E31) requiere el RNC o cédula válido del comprador. ' +
          'Verifica el identificador fiscal del cliente o emite una Factura de Consumo (E32).',
      );
    }

    const assigned = await this.complianceService.getNextNcf(organizationId, type, manager);
    return { ncf: assigned.ncf, documentType: assigned.type, expiresAt: assigned.expiresAt };
  }

  async assignCreditNoteNumber(
    context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment> {
    const { organizationId, manager, requestedType, originalInvoice } = context;

    // A note must be drawn from the series that matches the document it modifies: an electronic
    // invoice is credited electronically (E34), a pre-printed one on paper (B04).
    const inferred = originalInvoice.ncfNumber?.toUpperCase().startsWith('B')
      ? NcfType.B04
      : NcfType.E34;
    const type = requestedType ?? inferred;

    if (!CREDIT_NOTE_NCF_TYPES.includes(type)) {
      throw new BadRequestException(
        `El tipo ${type} no es un comprobante de nota de crédito válido.`,
      );
    }

    const assigned = await this.complianceService.getNextNcf(organizationId, type, manager);
    return { ncf: assigned.ncf, documentType: assigned.type, expiresAt: assigned.expiresAt };
  }

  /** Crédito fiscal for a verified taxpayer, consumo otherwise. */
  private inferSalesType(invoice: Invoice): NcfType {
    return this.hasValidDominicanTaxId(invoice) ? NcfType.E31 : NcfType.E32;
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
