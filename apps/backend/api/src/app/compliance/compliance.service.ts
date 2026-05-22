
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Between, EntityManager, Repository, Not, IsNull } from 'typeorm';
import { NcfSequence, NcfType } from './entities/ncf-sequence.entity';
import { VendorBill } from '../accounts-payable/entities/vendor-bill.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { DominicanRepublicReports } from './reports/dr-reports';

@Injectable()
export class ComplianceService {
  constructor(
    @InjectRepository(NcfSequence)
    private readonly ncfSequenceRepository: Repository<NcfSequence>,
    @InjectRepository(VendorBill)
    private readonly vendorBillRepository: Repository<VendorBill>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
  ) {}

  async getNextNcf(
    organizationId: string,
    type: NcfType,
    manager: EntityManager,
  ): Promise<string> {
    const sequence = await manager
      .getRepository(NcfSequence)
      .createQueryBuilder('seq')
      .where(
        'seq.organizationId = :organizationId AND seq.type = :type AND seq.isActive = true',
        { organizationId, type },
      )
      .setLock('pessimistic_write')
      .getOne();

    if (!sequence) {
      throw new InternalServerErrorException(`No se encontró una secuencia de NCF activa para el tipo ${type}`);
    }

    if (sequence.currentSequence >= sequence.endsAt) {
      throw new InternalServerErrorException(`La secuencia de NCF para el tipo ${type} se ha agotado.`);
    }

    sequence.currentSequence++;
    await manager.save(sequence);

    const sequenceNumber = sequence.currentSequence.toString().padStart(8, '0');
    return `${sequence.prefix}${sequenceNumber}`;
  }
  
  async generate607Report(organizationId: string, year: number, month: number): Promise<string> {
     // TODO: Check organization country before generating.
     return DominicanRepublicReports.generate607Report(organizationId, year, month, this.invoiceRepository);
  }

  async generate606Report(organizationId: string, year: number, month: number): Promise<string> {
     // TODO: Check organization country before generating.
     return DominicanRepublicReports.generate606Report(organizationId, year, month, this.vendorBillRepository);
  }
}