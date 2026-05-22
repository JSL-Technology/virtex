import { RoleEnum } from '../roles/enums/role.enum';

export const DEFAULT_ROLES = [
    {
      name: RoleEnum.ADMINISTRATOR,
      description: 'USER.ROLE.ADMINISTRATOR_DESC',
      permissions: ['*'],
      isSystemRole: true,
    },
    {
      name: RoleEnum.MEMBER,
      description: 'USER.ROLE.MEMBER_DESC',
      permissions: ['invoices:view', 'products:view'],
      isSystemRole: true,
    },
    {
      name: RoleEnum.SELLER,
      description: 'USER.ROLE.SELLER_DESC',
      permissions: [
        'dashboard:view',
        'customers:view',
        'customers:create',
        'customers:edit',
        'products:view',
        'sales:create',
        'invoices:view',
        'invoices:create',
        'invoices:edit',
      ],
      isSystemRole: true,
    },
    {
      name: RoleEnum.ACCOUNTANT,
      description: 'USER.ROLE.ACCOUNTANT_DESC',
      permissions: [
        'dashboard:view',
        'accounting:view',
        'reports:view',
        'customers:view',
        'suppliers:view',
        'invoices:view',
        'bills:view',
        'journal-entries:create',
        'journal-entries:view',
        'chart-of-accounts:view',
        'chart-of-accounts:edit',
      ],
      isSystemRole: true,
    },
  ];
