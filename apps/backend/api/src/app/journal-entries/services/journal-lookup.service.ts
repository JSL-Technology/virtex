import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Journal } from '../entities/journal.entity';
import { BadRequestError } from '../../i18n/localized.exception';
import type { SystemJournalCode } from '../../contracts/ledger-posting/system-journals';

@Injectable()
export class JournalLookupService {
  constructor(
    @InjectRepository(Journal)
    private readonly repo: Repository<Journal>,
  ) {}

  /** A journal every company has, by its code (`SYSTEM_JOURNALS`). */
  async findByCode(
    organizationId: string,
    code: SystemJournalCode,
    manager?: EntityManager,
  ): Promise<Journal | null> {
    const repo = manager ? manager.getRepository(Journal) : this.repo;
    return repo.findOne({ where: { organizationId, code } });
  }

  async requireByCode(
    organizationId: string,
    code: SystemJournalCode,
    manager?: EntityManager,
  ): Promise<Journal> {
    const journal = await this.findByCode(organizationId, code, manager);
    if (!journal) {
      throw new BadRequestError('journal_entries.journal_code_not_found', { code });
    }
    return journal;
  }

  async findAllForOrg(organizationId: string): Promise<Journal[]> {
    return this.repo.find({ where: { organizationId }, order: { name: 'ASC' } });
  }
}
