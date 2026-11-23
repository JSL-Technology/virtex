import { Injectable, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  FiscalNumberStretch,
  IssuedFiscalNumbersSource,
} from '../contracts/fiscal-records/issued-fiscal-numbers.contract';
import { IssuedFiscalNumbersRegistry } from '../contracts/fiscal-records/issued-fiscal-numbers.registry';
import { Invoice } from './entities/invoice.entity';

/**
 * The invoices, credit and debit notes that carry a number drawn from a range — voided ones too:
 * a voided document's number was issued, and the authority knows it.
 */
@Injectable()
export class InvoiceIssuedFiscalNumbers implements IssuedFiscalNumbersSource, OnModuleInit {
  readonly sourceName = 'invoices';

  constructor(private readonly registry: IssuedFiscalNumbersRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  countWithin(manager: EntityManager, stretch: FiscalNumberStretch): Promise<number> {
    return manager
      .getRepository(Invoice)
      .createQueryBuilder('invoice')
      .where('invoice.organizationId = :organizationId', { organizationId: stretch.organizationId })
      .andWhere('invoice.fiscalDocumentType = :documentType', { documentType: stretch.documentType })
      .andWhere('invoice.fiscalSeries = :series', { series: stretch.series })
      .andWhere('invoice.fiscalSequence BETWEEN :from AND :to', { from: stretch.from, to: stretch.to })
      .getCount();
  }
}
