import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { Invoice } from '../entities/invoice.entity';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { ComplianceService } from '../../compliance/compliance.service';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

/**
 * Dominican Republic fiscal numbering. Assigns the correct electronic e-NCF (e-CF) based on the
 * customer's fiscal condition:
 *   - E31 (Crédito Fiscal) when the buyer has an RNC and can claim the ITBIS credit;
 *   - E32 (Consumo) for a final consumer without an RNC;
 *   - E34 (Nota de Crédito) for credit notes.
 *
 * The previous adapter hardcoded B01 for every document regardless of the buyer, which is both a
 * legacy (non-electronic) type and the wrong one for consumo/credit-note cases.
 */
@Injectable()
export class DominicanRepublicFiscalAdapter implements FiscalAdapter {
  constructor(private readonly complianceService: ComplianceService) {}

  async processInvoice(
    invoice: Invoice,
    _dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager,
  ): Promise<void> {
    const rnc = invoice.customer?.taxId?.replace(/\D/g, '') || '';
    // A 9-digit RNC identifies a taxpayer entitled to the ITBIS credit → Crédito Fiscal (E31).
    // Otherwise it is a final-consumer sale → Consumo (E32).
    const type = rnc.length === 9 ? NcfType.E31 : NcfType.E32;
    invoice.ncfNumber = await this.complianceService.getNextNcf(organizationId, type, manager);
  }

  async processCreditNote(
    creditNote: Invoice,
    _originalInvoice: Invoice,
    organizationId: string,
    manager: EntityManager,
  ): Promise<void> {
    creditNote.ncfNumber = await this.complianceService.getNextNcf(
      organizationId,
      NcfType.E34,
      manager,
    );
  }
}
