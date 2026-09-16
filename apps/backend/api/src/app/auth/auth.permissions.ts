export const IAM_PERMISSIONS = {
  USERS_VIEW: 'users:view',
  USERS_CREATE: 'users:create',
  USERS_EDIT: 'users:edit',
  USERS_DELETE: 'users:delete',
  USERS_MANAGE_STATUS: 'users:manage_status',
  USERS_IMPERSONATE: 'users:impersonate',
  USERS_PASSWORD_RESET: 'users:password_reset',
  USERS_FORCE_LOGOUT: 'users:force_logout',
  USERS_SESSIONS_REVOKE: 'users:sessions_revoke',

  ROLES_VIEW: 'roles:view',
  ROLES_CREATE: 'roles:create',
  ROLES_EDIT: 'roles:edit',
  ROLES_DELETE: 'roles:delete',
} as const;
