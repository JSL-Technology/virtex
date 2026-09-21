import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';

import {
  INBOX_ITEM_LIMIT,
  InboxItem,
  ModuleInbox,
  ModuleInboxPort,
} from '../../shared/inbox/module-inbox.port';
import { ModuleInboxRegistry } from '../../shared/inbox/module-inbox.registry';
import { JournalEntry, JournalEntryStatus } from '../../journal-entries/entities/journal-entry.entity';
import { AccountingPeriod, PeriodStatus } from '../entities/accounting-period.entity';

/**
 * Lo que tiene bloqueado Contabilidad.
 *
 * Dos cosas, y las dos son de la EMPRESA y no de una persona: un asiento en borrador es un hecho
 * económico que ocurrió y no está en los libros, y un periodo cuya fecha de fin ya pasó y sigue
 * abierto es un mes que nadie ha cerrado. Las dos cuestan dinero cuanto más tiempo pasan ahí, que
 * es por lo que la bandeja ordena por antigüedad y no por fecha de creación.
 */
@Injectable()
export class AccountingInboxProvider extends ModuleInboxPort implements OnModuleInit {
  readonly moduleId = 'contabilidad';

  constructor(
    @InjectRepository(JournalEntry)
    private readonly entries: Repository<JournalEntry>,
    @InjectRepository(AccountingPeriod)
    private readonly periods: Repository<AccountingPeriod>,
    private readonly registry: ModuleInboxRegistry,
  ) {
    super();
  }

  /** Se apunta solo: la bandeja no lleva una lista de módulos que alguien deba recordar. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  async pending(organizationId: string): Promise<ModuleInbox> {
    const [drafts, draftCount] = await this.entries.findAndCount({
      where: { organizationId, status: JournalEntryStatus.DRAFT },
      order: { date: 'ASC' },
      take: INBOX_ITEM_LIMIT,
    });

    // Un periodo vencido y abierto: su fecha de fin ya pasó y nadie lo cerró.
    const [overdue, overdueCount] = await this.periods.findAndCount({
      where: { organizationId, status: PeriodStatus.OPEN, endDate: LessThan(new Date()) },
      order: { endDate: 'ASC' },
      take: INBOX_ITEM_LIMIT,
    });

    const items: InboxItem[] = [
      ...overdue.map((period) => ({
        id: period.id,
        titleKey: 'inbox.accounting.period_overdue',
        titleParams: { period: period.name },
        route: '/accounting/periods',
        blockedSince: new Date(period.endDate).toISOString(),
      })),
      ...drafts.map((entry) => ({
        id: entry.id,
        titleKey: 'inbox.accounting.draft_entry',
        titleParams: { number: entry.entryNumber ?? entry.id.slice(0, 8) },
        route: `/accounting/journal-entries/${entry.id}/edit`,
        blockedSince: new Date(entry.date).toISOString(),
      })),
    ]
      .sort((a, b) => a.blockedSince.localeCompare(b.blockedSince))
      .slice(0, INBOX_ITEM_LIMIT);

    return { moduleId: this.moduleId, count: draftCount + overdueCount, items };
  }
}
