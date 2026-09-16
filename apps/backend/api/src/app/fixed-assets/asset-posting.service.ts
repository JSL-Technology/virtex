import { Injectable } from '@nestjs/common';
import { EntityManager, QueryRunner } from 'typeorm';
import { AccountingPostingPort, PostingContext } from '../journal-entries/accounting-posting.port';
import { CreateJournalEntryDto } from '../journal-entries/dto/create-journal-entry.dto';
import { JournalEntry } from '../journal-entries/entities/journal-entry.entity';

/**
 * The only surface fixed-assets code touches to write the general ledger.
 *
 * Mirrors the intent of `AccountingPostingPort` — providing a narrow, explicit seam between the
 * fixed-assets bounded context and the accounting ledger — but typed for the three movements that
 * belong to this module: depreciation runs, asset disposals, and opening entries for assets
 * migrated in with a carrying value.
 *
 * Delegates every call to `AccountingPostingPort` so the concrete implementation and all its
 * balancing/period-lock/audit guarantees are inherited without duplication.
 */
@Injectable()
export class AssetPostingService {
  constructor(private readonly posting: AccountingPostingPort) {}

  createWithManager(
    manager: EntityManager,
    dto: CreateJournalEntryDto,
    organizationId: string,
    context?: PostingContext,
  ): Promise<JournalEntry> {
    return this.posting.createWithManager(manager, dto, organizationId, context);
  }

  createWithQueryRunner(
    queryRunner: QueryRunner,
    dto: CreateJournalEntryDto,
    organizationId: string,
    context?: PostingContext,
  ): Promise<JournalEntry> {
    return this.posting.createWithQueryRunner(queryRunner, dto, organizationId, context);
  }
}
