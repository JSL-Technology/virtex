import { EntityManager } from 'typeorm';
import { Invoice } from '../entities/invoice.entity';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';

export interface FiscalAdapter {
  processInvoice(
    invoice: Invoice,
    dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager
  ): Promise<void>;

  processCreditNote(
    creditNote: Invoice,
    originalInvoice: Invoice,
    organizationId: string,
    manager: EntityManager
  ): Promise<void>;
}
