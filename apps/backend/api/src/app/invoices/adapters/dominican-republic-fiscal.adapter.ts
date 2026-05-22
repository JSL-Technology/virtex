import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { Invoice } from '../entities/invoice.entity';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';
import { ComplianceService } from '../../compliance/compliance.service';
import { NcfType } from '../../compliance/entities/ncf-sequence.entity';

@Injectable()
export class DominicanRepublicFiscalAdapter implements FiscalAdapter {
  constructor(private readonly complianceService: ComplianceService) {}

  async processInvoice(
    invoice: Invoice,
    dto: CreateInvoiceDto,
    organizationId: string,
    manager: EntityManager
  ): Promise<void> {
    const ncfNumber = await this.complianceService.getNextNcf(
      organizationId,
      NcfType.B01, // Assuming B01 as default for now, could be dynamic based on customer type
      manager
    );
    invoice.ncfNumber = ncfNumber;
  }

  async processCreditNote(
    creditNote: Invoice,
    originalInvoice: Invoice,
    organizationId: string,
    manager: EntityManager
  ): Promise<void> {
    const creditNoteNcf = await this.complianceService.getNextNcf(
      organizationId,
      NcfType.B04,
      manager
    );
    creditNote.ncfNumber = creditNoteNcf;
  }
}
