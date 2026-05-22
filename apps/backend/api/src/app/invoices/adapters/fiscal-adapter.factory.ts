import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { GenericFiscalAdapter } from './generic-fiscal.adapter';
import { DominicanRepublicFiscalAdapter } from './dominican-republic-fiscal.adapter';
import { Organization } from '../../organizations/entities/organization.entity';

@Injectable()
export class FiscalAdapterFactory {
  constructor(
    private readonly genericAdapter: GenericFiscalAdapter,
    private readonly drAdapter: DominicanRepublicFiscalAdapter,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>
  ) {}

  async getAdapter(organizationId: string): Promise<FiscalAdapter> {
    const org = await this.orgRepository.findOne({ where: { id: organizationId } });
    if (org?.country === 'DO' || org?.country === 'Dominican Republic') {
        return this.drAdapter;
    }
    // Add more countries here
    return this.genericAdapter;
  }
}
