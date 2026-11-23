import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { EntityManager } from 'typeorm';
import { AfterCommitService } from '../../shared/after-commit/after-commit.service';
import { ForbiddenError } from '../../i18n/localized.exception';
import { BUDGET_EXCEEDED, type BudgetExceededEvent } from '../business-events/budget.events';

/**
 * Budget control, for the modules that post — the journal, supplier bills — without depending on
 * budgeting.
 *
 * The budgeting module DECIDES (`BudgetControlSource.decide`: within its line, warn, or refuse,
 * per the company's mode and tolerance) and registers itself when it starts. This contract ACTS on
 * the decision, the same way for every caller: a refusal throws in the caller's words; a warning is
 * published once the posting has committed (`BUDGET_EXCEEDED`), so a posting rolled back is never
 * announced. The journal and accounts payable used to import the budgeting service and hand it
 * their transaction — two modules reaching into a third.
 */
export interface BudgetPosting {
  accountId: string;
  /** What the posting consumes, in the account's spending sense. */
  amount: number;
  date: Date | string;
  dimensions?: Record<string, string>;
}

/** What the caller says about its own posting, for the refusal and for the warning. */
export interface BudgetEnforcement {
  /** The catalogue key of a refusal, in the words of the screen the posting came from. */
  refusalKey: string;
  source: BudgetExceededEvent['source'];
  actorUserId: string | null;
}

/**
 * Whether a budget on an account of this type is a LIMIT a posting can exceed.
 *
 * Budget control limits what the company spends or invests: expenses, and the assets it buys. A
 * budget on revenue, a liability or equity is a target — measured, never a reason to refuse a
 * posting (FINB-20). One rule, read by the budgeting module and by the journal before it asks.
 */
export function budgetLimitsPosting(accountType: string | null | undefined): boolean {
  return accountType === 'EXPENSE' || accountType === 'ASSET';
}

export type BudgetDecision =
  | { outcome: 'within' }
  | { outcome: 'block'; messageKey: string; params: Record<string, unknown> }
  | { outcome: 'warn'; exceeded: Omit<BudgetExceededEvent, 'source' | 'actorUserId' | 'organizationId'> };

export interface BudgetControlSource {
  /** Read in the caller's transaction, so a concurrent posting cannot slip between check and write. */
  decide(manager: EntityManager, organizationId: string, posting: BudgetPosting): Promise<BudgetDecision>;
}

@Injectable()
export class BudgetControlRegistry {
  private source: BudgetControlSource | null = null;

  constructor(
    private readonly afterCommit: AfterCommitService,
    private readonly events: EventEmitter2,
  ) {}

  provide(source: BudgetControlSource): void {
    this.source = source;
  }

  /**
   * Decide a posting against its budget and act on the decision. With no budgeting module
   * registered there is no budget to consult, and the posting passes — as it did before budgets
   * existed.
   */
  async enforce(
    manager: EntityManager,
    organizationId: string,
    posting: BudgetPosting,
    enforcement: BudgetEnforcement,
  ): Promise<BudgetDecision> {
    if (!this.source) return { outcome: 'within' };
    const decision = await this.source.decide(manager, organizationId, posting);

    if (decision.outcome === 'block') {
      throw new ForbiddenError(enforcement.refusalKey, { detail: decision.messageKey, ...decision.params });
    }
    if (decision.outcome === 'warn') {
      const event: BudgetExceededEvent = {
        ...decision.exceeded,
        organizationId,
        source: enforcement.source,
        actorUserId: enforcement.actorUserId,
      };
      await this.afterCommit.runAfterCommit(manager, BUDGET_EXCEEDED, async () => {
        this.events.emit(BUDGET_EXCEEDED, event);
      });
    }
    return decision;
  }
}
