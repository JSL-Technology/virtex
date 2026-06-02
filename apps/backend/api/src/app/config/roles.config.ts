import { RoleEnum } from '../roles/enums/role.enum';
import { PERMISSIONS, Permission } from '../shared/permissions';

// M-06 FIX: permissions are now built from the PERMISSIONS catalog (single source of truth).
// Typing each entry as `AssignablePermission` makes the compiler reject any string that is not
// part of the catalog, eliminating the previous "phantom" permissions (e.g. 'journal-entries:*',
// 'chart-of-accounts:*', 'dashboard:view', 'sales:create', 'accounting:view', 'suppliers:view')
// that never matched a guard requirement.
type AssignablePermission = Permission | '*';

export interface DefaultRole {
  name: RoleEnum;
  description: string;
  permissions: AssignablePermission[];
  isSystemRole: boolean;
}

export const DEFAULT_ROLES: DefaultRole[] = [
    {
      name: RoleEnum.ADMINISTRATOR,
      description: 'USER.ROLE.ADMINISTRATOR_DESC',
      permissions: ['*'],
      isSystemRole: true,
    },
    {
      name: RoleEnum.MEMBER,
      description: 'USER.ROLE.MEMBER_DESC',
      permissions: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.PRODUCTS_VIEW],
      isSystemRole: true,
    },
    {
      name: RoleEnum.SELLER,
      description: 'USER.ROLE.SELLER_DESC',
      permissions: [
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.CUSTOMERS_CREATE,
        PERMISSIONS.CUSTOMERS_EDIT,
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.INVOICES_VIEW,
        PERMISSIONS.INVOICES_CREATE,
        PERMISSIONS.INVOICES_EDIT,
      ],
      isSystemRole: true,
    },
    {
      name: RoleEnum.ACCOUNTANT,
      description: 'USER.ROLE.ACCOUNTANT_DESC',
      permissions: [
        PERMISSIONS.REPORTS_VIEW_FINANCIAL,
        PERMISSIONS.REPORTS_VIEW_SALES,
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.INVOICES_VIEW,
        PERMISSIONS.BILLS_VIEW,
        PERMISSIONS.JOURNAL_ENTRIES_CREATE,
        PERMISSIONS.JOURNAL_ENTRIES_VIEW,
        PERMISSIONS.CHART_OF_ACCOUNTS_VIEW,
        PERMISSIONS.CHART_OF_ACCOUNTS_EDIT,
      ],
      isSystemRole: true,
    },
  ];
