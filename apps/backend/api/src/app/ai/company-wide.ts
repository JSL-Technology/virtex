import { DataSource } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import { loadBranchScope } from '../organizations/contracts/branch.contract';
import { ForbiddenError } from '../i18n/localized.exception';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { CashflowReader } from './cashflow/cashflow.service';

/**
 * Refuse a person limited to some branches. The cash projection is computed for the whole company —
 * every account, every branch's invoices and bills — and cannot be cut by branch afterwards, so
 * showing it to someone who sees only their branch would show them the rest.
 */
export async function assertCompanyWide(dataSource: DataSource, user: AuthenticatedUser): Promise<void> {
  const scope = await loadBranchScope(dataSource.manager, user.organizationId, user.id);
  if (scope.allowed !== null) throw new ForbiddenError('ai.company_wide_only');
}

/** How a person may read a cash projection: payroll on its own line only with `payroll:view`. */
export function cashflowReader(permissions: readonly string[] | undefined): CashflowReader {
  return { seesPayroll: hasPermission([...(permissions ?? [])], [PERMISSIONS.PAYROLL_VIEW]) };
}
