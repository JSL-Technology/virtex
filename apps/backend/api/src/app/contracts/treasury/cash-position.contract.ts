import { Injectable } from '@nestjs/common';

/**
 * The company's cash today, as other modules may read it without depending on treasury: the sum of
 * its active bank and cash accounts in the base currency, from the general ledger.
 *
 * Treasury registers the source when it starts (the dependency points from treasury to here, never
 * from a reader to treasury); the cash-flow projection starts from this figure, so the projection
 * and treasury's own position screen cannot disagree.
 */
export interface CashPositionSummary {
  asOfDate: string;
  baseCurrency: string;
  total: number;
}

export interface CashPositionSource {
  summary(organizationId: string): Promise<CashPositionSummary>;
}

@Injectable()
export class CashPositionRegistry {
  private source: CashPositionSource | null = null;

  provide(source: CashPositionSource): void {
    this.source = source;
  }

  available(): boolean {
    return this.source !== null;
  }

  summary(organizationId: string): Promise<CashPositionSummary> {
    if (!this.source) throw new Error('No cash position source is registered.');
    return this.source.summary(organizationId);
  }
}
