/**
 * What a step-up token authorises.
 *
 * A scope is part of the token's signed payload and is compared against the scope the route
 * declares, so a token obtained to (say) open the billing portal cannot be replayed against
 * account deletion.
 */
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
  /** Binding a new passkey adds a credential that can sign in on its own. */
  REGISTER_PASSKEY = 'register_passkey',

  // ---------------------------------------------------------------------------------------
  // Administration of other people's accounts. Reusable within the token's lifetime (see
  // SINGLE_USE_SCOPES): an administrator onboarding a team should re-authenticate once, not
  // once per invitation. A control people turn off because it is unusable protects nothing.
  // ---------------------------------------------------------------------------------------
  /** Invite a member, edit their profile or role assignment. */
  MANAGE_USERS = 'manage_users',
  /** Activate, deactivate or block a member. */
  MANAGE_USER_STATUS = 'manage_user_status',
  /** Trigger a password reset or force a logout on someone else's account. */
  MANAGE_USER_CREDENTIALS = 'manage_user_credentials',
}

/**
 * Scopes whose token is burned the first time it is presented.
 *
 * The distinction is about blast radius, not convenience. Everything here is irreversible, or
 * grants access to data the operator does not otherwise hold, so a token that leaked must not be
 * replayable even inside its ten-minute window. Everything NOT here is routine administration
 * that is visible in the audit trail and can be undone, and is reusable until the token expires
 * so that a re-authentication prompt per click does not train people to click through it.
 */
export const SINGLE_USE_SCOPES: ReadonlySet<StepUpScope> = new Set([
  StepUpScope.DISABLE_2FA,
  StepUpScope.REGENERATE_BACKUP_CODES,
  StepUpScope.CHANGE_PASSWORD,
  StepUpScope.CHANGE_EMAIL,
  StepUpScope.DELETE_ACCOUNT,
  StepUpScope.MANAGE_PAYMENT,
  StepUpScope.IMPERSONATE,
  StepUpScope.REVOKE_SESSION,
  StepUpScope.REGISTER_PASSKEY,
  StepUpScope.ENABLE_2FA,
  StepUpScope.MANAGE_ROLES,
]);
