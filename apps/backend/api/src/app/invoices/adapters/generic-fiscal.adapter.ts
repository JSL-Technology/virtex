import { Injectable } from '@nestjs/common';
import {
  FiscalAdapter,
  FiscalAssignmentContext,
  FiscalDocumentTypeOption,
  FiscalNumberAssignment,
} from '../interfaces/fiscal-adapter.interface';
import { Invoice } from '../entities/invoice.entity';

/**
 * Markets whose electronic-invoicing regime this product does not yet implement.
 *
 * It assigns no fiscal number, which is the honest outcome: the internal document number from
 * `document_sequences` still identifies the document, the ledger entry is still posted, and nothing
 * pretends to have been stamped by an authority. `country-profiles.ts` marks these markets
 * `preview` for exactly this reason, and the signup discloses it before payment.
 */
@Injectable()
export class GenericFiscalAdapter implements FiscalAdapter {
  availableSalesTypes(): readonly FiscalDocumentTypeOption[] {
    return [];
  }

  async assignSalesNumber(_context: FiscalAssignmentContext): Promise<FiscalNumberAssignment> {
    return { ncf: null, documentType: null, expiresAt: null };
  }

  async assignCreditNoteNumber(
    _context: FiscalAssignmentContext & { originalInvoice: Invoice },
  ): Promise<FiscalNumberAssignment> {
    return { ncf: null, documentType: null, expiresAt: null };
  }
}
