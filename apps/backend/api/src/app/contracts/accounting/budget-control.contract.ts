/**
 * What a posting past its budget line does, per company (`OrganizationSettings.budgetControlMode`).
 *
 * - `block`: refused, and the person posting is told why. The default: it is what the control did
 *   before it could be configured, and loosening a control is a decision, not a default.
 * - `warn`: posted, and whoever looks after budgets is told (`BUDGET_EXCEEDED`).
 * - `none`: posted; the budget only measures, in the variance report.
 */
export const BUDGET_CONTROL_MODES = ['block', 'warn', 'none'] as const;
export type BudgetControlMode = (typeof BUDGET_CONTROL_MODES)[number];
