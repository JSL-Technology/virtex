import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { FiscalAdapter } from '../interfaces/fiscal-adapter.interface';
import { GenericFiscalAdapter } from './generic-fiscal.adapter';
import { DominicanRepublicFiscalAdapter } from './dominican-republic-fiscal.adapter';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * Picks the fiscal adapter for a tenant's market.
 *
 * Resolution is by ISO country code only. It used to also accept the literal string
 * `'Dominican Republic'`, a leftover from when `organizations.country` held a display name; keeping
 * both meant two spellings of one fact and no guarantee which one a row carried. Registration now
 * always writes the alpha-2 code.
 */
@Injectable()
export class FiscalAdapterFactory {
  constructor(
    private readonly genericAdapter: GenericFiscalAdapter,
    private readonly drAdapter: DominicanRepublicFiscalAdapter,
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
  ) {}

  /** Adapter for an organization, resolved inside the caller's transaction when one is given. */
  async getAdapter(organizationId: string, manager?: EntityManager): Promise<FiscalAdapter> {
    const repo = manager ? manager.getRepository(Organization) : this.orgRepository;
    const organization = await repo.findOne({
      where: { id: organizationId },
      select: ['id', 'country'],
    });
    return this.forCountry(organization?.country ?? null);
  }

  forCountry(countryCode: string | null): FiscalAdapter {
    switch ((countryCode ?? '').toUpperCase()) {
      case 'DO':
        return this.drAdapter;
      default:
        return this.genericAdapter;
    }
  }
}
