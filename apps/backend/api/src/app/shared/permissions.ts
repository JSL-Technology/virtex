
/**
 * All permissions in the system, composed from per-module declaration files.
 *
 * ## Why this file exists
 *
 * Each module declares its own permissions next to its controllers (e.g. `auth/auth.permissions.ts`).
 * This barrel merges them all into a single `PERMISSIONS` constant so the 88+ controllers and guards
 * that import `PERMISSIONS` continue working without a path change.
 *
 * ## Adding a new permission
 *
 * Add it to the appropriate module's `*.permissions.ts` file, NOT here. This file only merges.
 */

import { IAM_PERMISSIONS } from '../auth/auth.permissions';
import { ACCOUNTING_PERMISSIONS } from '../accounting/accounting.permissions';
import { FINANCE_PERMISSIONS } from '../treasury/treasury.permissions';
import { SALES_PERMISSIONS } from '../invoices/invoices.permissions';
import { INVENTORY_PERMISSIONS } from '../inventory/inventory.permissions';
import { PAYROLL_PERMISSIONS } from '../payroll/payroll.permissions';
import { REPORTS_PERMISSIONS } from '../reports/reports.permissions';
import { CONFIG_PERMISSIONS } from '../config/config.permissions';

export const PERMISSIONS = {
  ...IAM_PERMISSIONS,
  ...ACCOUNTING_PERMISSIONS,
  ...FINANCE_PERMISSIONS,
  ...SALES_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  ...REPORTS_PERMISSIONS,
  ...CONFIG_PERMISSIONS,
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);
