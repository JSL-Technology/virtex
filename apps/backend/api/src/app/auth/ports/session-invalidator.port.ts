/**
 * The session-termination surface UsersService needs when deactivating a user.
 *
 * UsersService used to inject the full SessionService (from AuthModule) which created the
 * Auth ↔ Users forwardRef cycle. This port narrows the dependency to the one method needed.
 *
 * SessionService implements this. AuthModule binds the token and re-exports it via
 * UserCacheModule (already a leaf) or directly.
 */
export abstract class SessionInvalidatorPort {
  /** Terminate every active session for a user immediately. */
  abstract terminateAllSessions(userId: string): Promise<void>;
}
