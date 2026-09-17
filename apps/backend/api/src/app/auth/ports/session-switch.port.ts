/**
 * The session-management surface OrganizationsController needs when a user switches tenants.
 *
 * Lives in auth/ because the methods it abstracts are part of AuthService. OrganizationsController
 * injects this port so it does not depend on the full AuthService — and the forwardRef between
 * OrganizationsModule and AuthModule is narrowed to just this contract.
 */
export abstract class SessionSwitchPort {
  /** Whether the session was created with "remember me". */
  abstract isRememberedSession(sessionId?: string): Promise<boolean>;

  /** Revoke a specific session for a user. */
  abstract revokeSession(userId: string, sessionId: string): Promise<unknown>;
}
