import { defaultFxTreatmentForType, type FxTreatment } from '@virtex/shared/types';
import { AccountRole } from './account-role.contract';

export { FX_TREATMENTS, isFxTreatmentAllowedForType, type FxTreatment } from '@virtex/shared/types';

/**
 * The operational roles whose balance is a monetary item (IAS 21.16): money held, and amounts to
 * be received or paid in a fixed number of units of currency. Restated at the closing rate.
 */
export const MONETARY_ROLES: ReadonlySet<AccountRole> = new Set([
  AccountRole.CASH,
  AccountRole.BANK,
  AccountRole.ACCOUNTS_RECEIVABLE,
  // The allowance measures the same receivables: restated with them, or a dollar receivable
  // provisioned at last year's rate overstates the net amount expected.
  AccountRole.DOUBTFUL_ALLOWANCE,
  AccountRole.TAX_RECEIVABLE,
  AccountRole.WITHHOLDING_RECEIVABLE,
  AccountRole.ACCOUNTS_PAYABLE,
  AccountRole.GOODS_RECEIVED_NOT_INVOICED,
  AccountRole.TAX_PAYABLE,
  AccountRole.EXCISE_TAX_PAYABLE,
  AccountRole.WITHHOLDING_PAYABLE,
  AccountRole.SERVICE_CHARGE_PAYABLE,
  AccountRole.PAYROLL_NET_PAYABLE,
  AccountRole.PENSION_CONTRIBUTIONS_PAYABLE,
  AccountRole.HEALTH_CONTRIBUTIONS_PAYABLE,
  AccountRole.OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE,
  AccountRole.PAYROLL_TAX_WITHHOLDING_PAYABLE,
]);

/**
 * The foreign-currency treatment an account starts with: by its role when it has one, by its type
 * otherwise (`defaultFxTreatmentForType`).
 *
 * Customer advances are NOT monetary: an advance the company will settle by delivering goods or
 * services is a non-monetary liability, measured at the rate of the day it was received (IFRIC 22).
 * The revaluation restated them until now. A refundable deposit is monetary, and its account can be
 * marked so — a judgement for the company's accountant, which the account form asks for.
 */
export function defaultFxTreatment(type: string | null | undefined, role: AccountRole | string | null | undefined): FxTreatment {
  if (type !== 'ASSET' && type !== 'LIABILITY') return 'HISTORICAL';
  if (role) return MONETARY_ROLES.has(role as AccountRole) ? 'REVALUED' : 'HISTORICAL';
  return defaultFxTreatmentForType(type);
}
