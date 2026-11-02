import { Injectable, OnModuleInit } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  LedgerPostingContext,
  LedgerPostingGateway,
  LedgerPostingModule,
  LedgerPostingRegistry,
  LedgerPostingRequest,
  LedgerWords,
} from '../contracts/ledger-posting/ledger-posting.contract';
import { AccountingPostingPort, ModuleSlug, PostingContext } from './accounting-posting.port';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { LedgerNarrativeService } from './ledger-narrative.service';
import { JournalLookupService } from './services/journal-lookup.service';
import { BadRequestError } from '../i18n/localized.exception';

const MODULES: Record<LedgerPostingModule, ModuleSlug> = {
  'general-ledger': ModuleSlug.GL,
  'accounts-payable': ModuleSlug.AP,
  'accounts-receivable': ModuleSlug.AR,
  inventory: ModuleSlug.INVENTORY,
};

/** Accounting's side of the ledger-posting contract: the posting port, behind the contract's words. */
@Injectable()
export class LedgerPostingGatewayImpl implements LedgerPostingGateway, OnModuleInit {
  constructor(
    private readonly registry: LedgerPostingRegistry,
    private readonly posting: AccountingPostingPort,
    private readonly narrative: LedgerNarrativeService,
    private readonly journals: JournalLookupService,
  ) {}

  onModuleInit(): void {
    this.registry.provide(this);
  }

  async post(
    manager: EntityManager,
    organizationId: string,
    request: LedgerPostingRequest,
    context: LedgerPostingContext,
  ): Promise<{ id: string }> {
    const journal = await this.journals.findByCode(organizationId, request.journalCode, manager);
    if (!journal) {
      throw new BadRequestError('invoices.no_journal_code_organization_create_under', { code: request.journalCode });
    }
    const dto: CreateJournalEntryDto = {
      date: new Date(`${request.date}T00:00:00.000Z`).toISOString(),
      description: request.description,
      journalId: journal.id,
      currencyCode: request.currencyCode,
      exchangeRate: request.exchangeRate ?? 1,
      lines: request.lines.map((line) => ({ ...line })),
    } as CreateJournalEntryDto;
    const entry = await this.posting.createWithManager(manager, dto, organizationId, this.context(context));
    return { id: entry.id };
  }

  async reverse(
    manager: EntityManager,
    organizationId: string,
    entryId: string,
    reversal: { date: string; reason: string },
    context: LedgerPostingContext,
  ): Promise<void> {
    await this.posting.createSystemReversal(
      entryId,
      organizationId,
      { reversalDate: reversal.date, reason: reversal.reason },
      manager,
      this.context(context),
    );
  }

  describeAll<K extends string>(manager: EntityManager, organizationId: string, words: LedgerWords<K>): Promise<Record<K, string>> {
    return this.narrative.describeAll(manager, organizationId, words);
  }

  private context(context: LedgerPostingContext): PostingContext {
    return {
      actorUserId: context.actorUserId ?? null,
      systemReason: context.systemReason,
      idempotencyKey: context.idempotencyKey,
      module: context.module ? MODULES[context.module] : undefined,
    };
  }
}
