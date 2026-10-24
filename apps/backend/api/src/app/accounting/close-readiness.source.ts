import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CloseReadiness, CloseReadinessRegistry, CloseReadinessSource } from '../contracts/closing/close-readiness.contract';
import { NotFoundError } from '../i18n/localized.exception';
import { toIsoDate } from '../chart-of-accounts/account-balances.service';
import { AccountingPeriod } from './entities/accounting-period.entity';
import { ClosingChecklistService } from './closing-checklist.service';

/** Answers "how ready is this period to close" for readers outside accounting: the checklist itself. */
@Injectable()
export class CloseReadinessSourceService implements CloseReadinessSource, OnModuleInit {
  constructor(
    private readonly registry: CloseReadinessRegistry,
    private readonly checklist: ClosingChecklistService,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.provide(this);
  }

  async readiness(organizationId: string, periodId: string): Promise<CloseReadiness> {
    const period = await this.dataSource.getRepository(AccountingPeriod).findOneBy({ id: periodId, organizationId });
    if (!period) throw new NotFoundError('accounting.accounting_period_period_id_not_found', { periodId });
    return {
      period: { id: period.id, name: period.name, startDate: toIsoDate(period.startDate), endDate: toIsoDate(period.endDate), status: period.status },
      checklist: await this.checklist.getChecklist(periodId, organizationId),
    };
  }
}
