/**
 * The password-verification surface UsersService needs for the change-password flow.
 *
 * UsersService used to inject the full PasswordService (from AuthModule), creating the
 * Auth ↔ Users forwardRef cycle. This port narrows it to the one method needed.
 *
 * PasswordService implements this. AuthModule binds the token and exports it.
 */
export abstract class PasswordVerifierPort {
  /** Returns true when `plain` matches the stored `hash`. */
  abstract verify(hash: string, plain: string): Promise<boolean>;
}
