import { Injectable } from '@nestjs/common';
import { ApprovalSource } from './approval-source.contract';

/** The sources of pending decisions the domains registered (see `ApprovalSource`). */
@Injectable()
export class ApprovalSourceRegistry {
  private readonly sources = new Map<string, ApprovalSource>();

  register(source: ApprovalSource): void {
    if (!this.sources.has(source.sourceId)) this.sources.set(source.sourceId, source);
  }

  get(id: string): ApprovalSource | undefined {
    return this.sources.get(id);
  }

  all(): ApprovalSource[] {
    return [...this.sources.values()];
  }
}
