
export enum StepUpScope {
  ENABLE_2FA = 'enable_2fa',
  DISABLE_2FA = 'disable_2fa',
  REGENERATE_BACKUP_CODES = 'regenerate_backup_codes',
  CHANGE_PASSWORD = 'change_password',
  CHANGE_EMAIL = 'change_email',
  DELETE_ACCOUNT = 'delete_account',
  MANAGE_PAYMENT = 'manage_payment',
  REVOKE_SESSION = 'revoke_session',
  /**
   * Assuming another user's identity is among the most sensitive actions in the product: it
   * grants full access to their data and is attributable to them in the audit trail. It must
   * therefore require a fresh proof of the operator's own credentials, not merely a live session.
   */
  IMPERSONATE = 'impersonate',
  /** Granting or changing a role rewrites the authorization graph. */
  MANAGE_ROLES = 'manage_roles',
}
