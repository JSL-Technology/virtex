import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Ledger } from '../entities/ledger.entity';
import { BadRequestError } from '../../i18n/localized.exception';

@Injectable()
export class LedgerLookupService {
  constructor(
    @InjectRepository(Ledger)
    private readonly repo: Repository<Ledger>,
  ) {}

  async findDefault(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<Ledger | null> {
    const repo = manager?.getRepository(Ledger) ?? this.repo;
    return repo.findOne({ where: { organizationId, isDefault: true } });
  }

  async requireDefault(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<Ledger> {
    const ledger = await this.findDefault(organizationId, manager);
    if (!ledger) {
      throw new BadRequestError('accounting.default_ledger_not_found');
    }
    return ledger;
  }

  async findDefaultId(
    organizationId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const ledger = await this.requireDefault(organizationId, manager);
    return ledger.id;
  }
}
