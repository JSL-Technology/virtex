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
  /**
   * Reveal the real IP a session was opened from.
   *
   * Separate from `USERS_SESSIONS_REVOKE` because it is a different act: revoking ends access,
   * this discloses personal data. `refresh_tokens.encrypted_ip` exists for exactly this and had no
   * reader at all, which meant the data was collected, encrypted and never usable — a liability
   * rather than a capability (GDPR Art. 5(1)(b): collected for a purpose it could not serve).
   */
  USERS_SESSIONS_FORENSICS: 'users:sessions_forensics',

  ROLES_VIEW: 'roles:view',
  ROLES_CREATE: 'roles:create',
  ROLES_EDIT: 'roles:edit',
  ROLES_DELETE: 'roles:delete',
} as const;
