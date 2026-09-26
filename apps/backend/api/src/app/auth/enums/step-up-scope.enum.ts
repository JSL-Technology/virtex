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
  /**
   * Revealing the real IP address a session was opened from. Disclosure of personal data during an
   * incident investigation: irreversible once read, so it is single-use and audited.
   */
  REVEAL_SESSION_ORIGIN = 'reveal_session_origin',

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

  // ---------------------------------------------------------------------------------------
  // Actions that were left uncovered by the first pass of this mechanism. Each one is
  // irreversible, moves money, or grants access the operator does not otherwise hold — the same
  // test every scope above satisfies.
  // ---------------------------------------------------------------------------------------
  /**
   * Configuring the tenant's identity provider.
   *
   * An IdP decides who may sign in and, through `defaultRoleId`, with what rights. It is a change
   * to the authorization graph exactly as `MANAGE_ROLES` is, and it was reachable with a live
   * session and `settings:edit_company` alone.
   */
  MANAGE_SSO = 'manage_sso',
  /**
   * Publishing or revoking an extension.
   *
   * Publishing puts code into the sandbox and into other people's browsers; revoking withdraws it
   * from every tenant at once. Both are platform-wide and irreversible in effect.
   */
  PUBLISH_EXTENSION = 'publish_extension',
  /**
   * Approving or paying a payroll run.
   *
   * It moves money and settles the salary data of every employee in the tenant. Reusable within
   * the token's lifetime would mean one re-authentication covering an unbounded number of runs, so
   * this one burns.
   */
  APPROVE_PAYROLL = 'approve_payroll',
  /**
   * Reading payroll data: runs, payslips, individual salaries.
   *
   * Deliberately NOT single-use. Payroll is a job people do for hours at a time, and a control
   * that prompts on every row is a control people route around. Re-authenticating once per
   * ten-minute window is the trade the rest of this enum already makes for routine administration.
   */
  VIEW_PAYROLL_DATA = 'view_payroll_data',
  /**
   * Rebuilding the shared analytical view.
   *
   * `synchronizeView` DROPs `analytical_report_data` and recreates it for the whole installation.
   * It is destructive, it is platform-wide, and until this audit it was reachable with nothing but
   * a live session and a permission every tenant administrator holds. Single-use: one
   * re-authentication must not cover an unbounded number of rebuilds of a view every customer
   * reports from.
   */
  REBUILD_ANALYTICAL_VIEW = 'rebuild_analytical_view',
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
  StepUpScope.REVEAL_SESSION_ORIGIN,
  StepUpScope.MANAGE_SSO,
  StepUpScope.PUBLISH_EXTENSION,
  StepUpScope.APPROVE_PAYROLL,
  StepUpScope.REBUILD_ANALYTICAL_VIEW,
]);
