/**
 * A company's AI spending crossed a share of its budget this month — told once per threshold.
 *
 * Emitted by the AI module after a call is recorded; the notifications module decides who is told
 * (those who read the AI usage). Neither imports the other.
 */
export const AI_BUDGET_THRESHOLD = 'ai.budget.threshold';

export interface AiBudgetThresholdEvent {
  organizationId: string;
  /** 50, 80 or 100. */
  percent: number;
  /** `YYYY-MM`. */
  month: string;
  spentUsd: number;
  budgetUsd: number;
}
