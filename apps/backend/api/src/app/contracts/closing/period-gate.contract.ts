import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

/**
 * Whether a date can be posted to, readable by operational modules that must not depend on
 * accounting (inventory, purchasing, sales, payroll).
 *
 * The rule — a period exists for the date, it is open overall, open for the general ledger and
 * open for the subledger asking — has one implementation, in accounting. This contract is how
 * the others ask it without importing accounting's entities or functions: accounting registers
 * the source when it starts, exactly like `CloseReadinessRegistry`.
 */
export type PeriodSubledger = 'GL' | 'AP' | 'AR' | 'INVENTORY';

export interface PeriodGateAnswer {
  /** The period covering the date, or null when the calendar has none. */
  period: { id: string; name: string } | null;
  /** Closed overall or for the general ledger. */
  ledgerClosed: boolean;
  /** Closed for the subledger that asked. */
  subledgerClosed: boolean;
}

export interface PeriodGateSource {
  answer(
    manager: EntityManager,
    organizationId: string,
    isoDate: string,
    subledger: PeriodSubledger,
  ): Promise<PeriodGateAnswer>;
}

@Injectable()
export class PeriodGateRegistry implements PeriodGateSource {
  private source: PeriodGateSource | null = null;

  provide(source: PeriodGateSource): void {
    this.source = source;
  }

  answer(
    manager: EntityManager,
    organizationId: string,
    isoDate: string,
    subledger: PeriodSubledger,
  ): Promise<PeriodGateAnswer> {
    // Failing closed: an operational module that cannot learn whether the period is open must not
    // post into it on the assumption that it is.
    if (!this.source) throw new Error('No period gate source is registered (accounting not loaded).');
    return this.source.answer(manager, organizationId, isoDate, subledger);
  }
}
