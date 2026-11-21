import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { InternalServerError } from '../../i18n/localized.exception';
import { FiscalNumberStretch, IssuedFiscalNumbersSource } from './issued-fiscal-numbers.contract';

/**
 * Where every kind of document that draws from the tenant's authorised ranges registers itself, so
 * the ranges can be checked against the numbers already issued without importing those documents.
 *
 * Several sources, not one: an invoice and a till receipt draw from the same ranges. With none
 * registered the question cannot be answered, and it is refused rather than answered «none» — a
 * range registered over numbers already on customers' documents is the failure this exists to stop.
 */
@Injectable()
export class IssuedFiscalNumbersRegistry {
  private readonly sources = new Map<string, IssuedFiscalNumbersSource>();

  register(source: IssuedFiscalNumbersSource): void {
    const existing = this.sources.get(source.sourceName);
    if (existing && existing !== source) {
      throw new Error(`Issued fiscal numbers already answered by another «${source.sourceName}» source.`);
    }
    this.sources.set(source.sourceName, source);
  }

  reset(): void {
    this.sources.clear();
  }

  /** The documents of every source that carry a number within the stretch. */
  async countWithin(manager: EntityManager, stretch: FiscalNumberStretch): Promise<number> {
    if (this.sources.size === 0) throw new InternalServerError('einvoicing.issued_numbers_unavailable');
    let total = 0;
    for (const source of this.sources.values()) total += await source.countWithin(manager, stretch);
    return total;
  }
}
