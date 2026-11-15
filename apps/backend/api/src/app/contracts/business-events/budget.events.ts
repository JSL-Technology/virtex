/**
 * A posting went past its budget line, and the company's budget control lets it through with a
 * warning (`budgetControlMode = 'warn'`). Published after the commit by `BudgetControlService`, so a
 * listener reads a posting that exists; under `block` the posting is refused instead and nothing is
 * published.
 */
export const BUDGET_EXCEEDED = 'budget.exceeded';

export interface BudgetExceededEvent {
  organizationId: string;
  budgetName: string;
  /** `YYYY-MM`: the month the budget covers. */
  period: string;
  accountId: string;
  accountCode: string | null;
  budgeted: number;
  /** Consumed after this posting, in the account's natural sense. */
  actual: number;
  /** What this posting added. */
  amount: number;
  /** Where the posting came from. */
  source: 'journal' | 'vendor_bill';
  /** Who posted it; `null` for a posting with no person behind it. */
  actorUserId: string | null;
}
