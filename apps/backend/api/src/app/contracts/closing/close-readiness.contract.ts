import { Injectable } from '@nestjs/common';
import type { ClosingBlocker } from '../closing-blockers/closing-blocker.contract';

/**
 * How ready a period is to close, readable by modules that do not depend on accounting (the close
 * assistant in the AI module). Accounting registers the source when it starts; the checklist the
 * assistant explains is the very one the closing screen shows, so they cannot disagree.
 */
export interface ClosePeriodSummary {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
}

export interface CloseReadiness {
  period: ClosePeriodSummary;
  checklist: ClosingBlocker[];
}

export interface CloseReadinessSource {
  readiness(organizationId: string, periodId: string): Promise<CloseReadiness>;
}

@Injectable()
export class CloseReadinessRegistry {
  private source: CloseReadinessSource | null = null;

  provide(source: CloseReadinessSource): void {
    this.source = source;
  }

  available(): boolean {
    return this.source !== null;
  }

  readiness(organizationId: string, periodId: string): Promise<CloseReadiness> {
    if (!this.source) throw new Error('No close readiness source is registered.');
    return this.source.readiness(organizationId, periodId);
  }
}
