/**
 * Which categories an account TYPE admits — one definition for the API and the browser.
 *
 * The category decides where the account lands on the financial statements (current vs.
 * non-current, operating vs. not). It is a refinement of the type, never an independent axis: an
 * EXPENSE account classified as CURRENT_ASSET would be summed into the balance sheet as an asset
 * while its postings behave as an expense, and the statements stop reconciling. The form offered
 * every category for every type and the API stored the pair unchecked (QA M-04).
 */
export const ACCOUNT_CATEGORIES_BY_TYPE = {
  ASSET: ['CURRENT_ASSET', 'NON_CURRENT_ASSET'],
  LIABILITY: ['CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY'],
  EQUITY: ['OWNERS_EQUITY', 'RETAINED_EARNINGS'],
  REVENUE: ['OPERATING_REVENUE', 'NON_OPERATING_REVENUE'],
  EXPENSE: ['OPERATING_EXPENSE', 'NON_OPERATING_EXPENSE', 'COST_OF_GOODS_SOLD'],
} as const satisfies Record<string, readonly string[]>;

export type AccountTypeCode = keyof typeof ACCOUNT_CATEGORIES_BY_TYPE;

/** Whether `category` is a valid refinement of `type`. Unknown types admit nothing. */
export function isCategoryAllowedForType(type: string | null | undefined, category: string | null | undefined): boolean {
  if (!type || !category) return false;
  const allowed = (ACCOUNT_CATEGORIES_BY_TYPE as Record<string, readonly string[]>)[type];
  return !!allowed && allowed.includes(category);
}
