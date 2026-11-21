import { Injectable, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  FiscalNumberStretch,
  IssuedFiscalNumbersSource,
} from '../contracts/fiscal-records/issued-fiscal-numbers.contract';
import { IssuedFiscalNumbersRegistry } from '../contracts/fiscal-records/issued-fiscal-numbers.registry';
import { PosSale } from './entities/pos-sale.entity';

/** The till receipts that carry a number drawn from a range, voided sales included. */
@Injectable()
export class PosIssuedFiscalNumbers implements IssuedFiscalNumbersSource, OnModuleInit {
  readonly sourceName = 'pos';

  constructor(private readonly registry: IssuedFiscalNumbersRegistry) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  countWithin(manager: EntityManager, stretch: FiscalNumberStretch): Promise<number> {
    return manager
      .getRepository(PosSale)
      .createQueryBuilder('sale')
      .where('sale.organizationId = :organizationId', { organizationId: stretch.organizationId })
      .andWhere('sale.fiscalDocumentType = :documentType', { documentType: stretch.documentType })
      .andWhere('sale.fiscalSeries = :series', { series: stretch.series })
      .andWhere('sale.fiscalSequence BETWEEN :from AND :to', { from: stretch.from, to: stretch.to })
      .getCount();
  }
}
