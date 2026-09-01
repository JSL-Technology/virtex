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
  /**
   * A catalogue key, NOT a sentence.
   *
   * These four strings are written into the `description` column of every organisation created,
   * and `roles.page.html` rendered `{{ role.description }}` with no pipe — so the settings screen
   * showed the literal text `USER.ROLE.ADMINISTRATOR_DESC` to every customer, in both languages.
   * The key was right; nothing translated it, and nothing defined it either. `RolesService` now
   * resolves it on the way out, and `roles.config.spec.ts` asserts the keys exist.
   */
  description: string;
  permissions: AssignablePermission[];
  isSystemRole: boolean;
}

export const DEFAULT_ROLES: DefaultRole[] = [
    {
      name: RoleEnum.ADMINISTRATOR,
      description: 'ROLES.SYSTEM.ADMINISTRATOR.DESCRIPTION',
      permissions: ['*'],
      isSystemRole: true,
    },
    {
      name: RoleEnum.MEMBER,
      description: 'ROLES.SYSTEM.MEMBER.DESCRIPTION',
      permissions: [PERMISSIONS.INVOICES_VIEW, PERMISSIONS.PRODUCTS_VIEW],
      isSystemRole: true,
    },
    {
      name: RoleEnum.SELLER,
      description: 'ROLES.SYSTEM.SELLER.DESCRIPTION',
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
      description: 'ROLES.SYSTEM.ACCOUNTANT.DESCRIPTION',
      permissions: [
        // An accountant reconciles the subscription against the books, so they read billing —
        // but they do not change the plan or the payment method. Administrators keep '*'.
        PERMISSIONS.BILLING_VIEW,
        PERMISSIONS.REPORTS_VIEW_FINANCIAL,
        PERMISSIONS.REPORTS_VIEW_SALES,
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.INVOICES_VIEW,
        PERMISSIONS.BILLS_VIEW,
        PERMISSIONS.JOURNAL_ENTRIES_CREATE,
        PERMISSIONS.JOURNAL_ENTRIES_VIEW,
        PERMISSIONS.CHART_OF_ACCOUNTS_VIEW,
        PERMISSIONS.CHART_OF_ACCOUNTS_EDIT,
        // Reading the period calendar is what tells an accountant which month they may still post
        // into. Closing and reopening it stay separate permissions.
        PERMISSIONS.ACCOUNTING_VIEW,
      ],
      isSystemRole: true,
    },
  ];
