import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { Invoice } from '../entities/invoice.entity';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';

@Injectable()
export class GenericFiscalAdapter implements FiscalAdapter {
  async processInvoice(
    invoice: Invoice,
    dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager
  ): Promise<void> {
    // Generic implementation: No special fiscal number generation like NCF
    // Could generate a simple sequential invoice number if not already handled,
    // but InvoicesService already handles internal sequence.

    invoice.ncfNumber = null; // No NCF for generic
  }

  async processCreditNote(
    creditNote: Invoice,
    originalInvoice: Invoice,
    organizationId: string,
    manager: EntityManager
  ): Promise<void> {
    creditNote.ncfNumber = null;
  }
}
