
/**
 * Every permission in the system, by area.
 *
 * ## Why the catalogue is platform, and not nine files inside nine modules
 *
 * It used to be: each area declared its permissions next to its controllers and this barrel merged
 * the nine. The barrel lives in `shared/`, which is PLATFORM, and platform may not depend on a
 * business module — that is its entire definition (`module-boundaries.config.mjs`). So one file
 * created seven of the fourteen module cycles the boundary check reported: plataforma ↔ ventas,
 * ↔ inventario, ↔ contabilidad, ↔ finanzas, ↔ rrhh, ↔ reportes and part of ↔ identidad. Six of
 * those pairs had no other reason to be coupled at all.
 *
 * A permission is not business logic. It is a word three different layers have to agree on: the
 * guard that resolves it (platform), the roles screen that enumerates it (`buildPermissionCatalogue`),
 * and the controller that declares it. That is the same shape as an i18n key and an error code, and
 * both of those live in platform for the same reason. Nine files of plain constants with zero
 * imports between them were sitting in business folders and dragging platform behind them.
 *
 * Moving them here changed nothing at the call sites: `from '.../shared/permissions'` resolved to
 * `shared/permissions.ts` and now resolves to this `index.ts`.
 *
 * ## Adding a permission
 *
 * In the file of its area, in this folder. The catalogue the roles screen shows is derived from
 * these constants (`roles/permission-catalogue.ts`), so a permission appears there by being here.
 */

import { IAM_PERMISSIONS } from './auth.permissions';
import { ACCOUNTING_PERMISSIONS } from './accounting.permissions';
import { FINANCE_PERMISSIONS } from './treasury.permissions';
import { SALES_PERMISSIONS } from './invoices.permissions';
import { INVENTORY_PERMISSIONS } from './inventory.permissions';
import { PAYROLL_PERMISSIONS } from './payroll.permissions';
import { REPORTS_PERMISSIONS } from './reports.permissions';
import { CONFIG_PERMISSIONS } from './config.permissions';
import { AI_PERMISSIONS } from './ai.permissions';

export const PERMISSIONS = {
  ...IAM_PERMISSIONS,
  ...ACCOUNTING_PERMISSIONS,
  ...FINANCE_PERMISSIONS,
  ...SALES_PERMISSIONS,
  ...INVENTORY_PERMISSIONS,
  ...PAYROLL_PERMISSIONS,
  ...REPORTS_PERMISSIONS,
  ...CONFIG_PERMISSIONS,
  ...AI_PERMISSIONS,
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);
