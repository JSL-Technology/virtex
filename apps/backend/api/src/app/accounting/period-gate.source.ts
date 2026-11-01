import { Injectable, OnModuleInit } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import {
  PeriodGateAnswer,
  PeriodGateRegistry,
  PeriodGateSource,
  PeriodSubledger,
} from '../contracts/closing/period-gate.contract';
import { findPeriodCovering, moduleStatusOf } from './period-status';
import { ModuleSlug, PeriodStatus } from './entities/accounting-period.entity';

const SLUG: Record<PeriodSubledger, ModuleSlug> = {
  GL: ModuleSlug.GL,
  AP: ModuleSlug.AP,
  AR: ModuleSlug.AR,
  INVENTORY: ModuleSlug.INVENTORY,
};

/** Accounting's answer to "may this date be posted to", for modules that cannot import accounting. */
@Injectable()
export class PeriodGateSourceService implements PeriodGateSource, OnModuleInit {
  constructor(private readonly registry: PeriodGateRegistry) {}

  onModuleInit(): void {
    this.registry.provide(this);
  }

  async answer(
    manager: EntityManager,
    organizationId: string,
    isoDate: string,
    subledger: PeriodSubledger,
  ): Promise<PeriodGateAnswer> {
    const period = await findPeriodCovering(manager, organizationId, isoDate);
    if (!period) return { period: null, ledgerClosed: false, subledgerClosed: false };
    return {
      period: { id: period.id, name: period.name },
      ledgerClosed: period.status === PeriodStatus.CLOSED || moduleStatusOf(period, ModuleSlug.GL) === PeriodStatus.CLOSED,
      subledgerClosed: moduleStatusOf(period, SLUG[subledger]) === PeriodStatus.CLOSED,
    };
  }
}
