import type {
  AuthUserContract,
  OrganizationContract,
  RoleContract,
} from '@virteex/shared/types';

/**
 * The user model consumed by the app.
 *
 * It derives from `AuthUserContract`, the single declaration shared with the backend, where
 * `UserResponseDto implements AuthUserContract`. This is deliberate: the two used to be written
 * independently and had drifted, and because the DTO serialises with
 * `excludeExtraneousValues: true`, every field declared here but missing there arrived as
 * `undefined` at runtime while TypeScript reported no problem on either side.
 *
 * The concrete damage that caused:
 *   - `roles` was declared required here and read by `user-management.page.ts`
 *     (`user.roles.map(r => r.name)`), but the DTO never exposed it — the members list always
 *     showed "Sin rol" and the edit dialog could not preselect a role;
 *   - `phone`, `jobTitle`, `avatarUrl` and `department` were likewise absent, so the profile
 *     screen could not render them and saving the profile returned a payload without `phone`,
 *     blanking the field the user had just filled in.
 *
 * Extending the shared contract turns that entire class of mismatch into a compile error.
 * Add fields to the contract, not to this interface.
 */
export type Role = RoleContract;
export type Organization = OrganizationContract;

export interface User extends AuthUserContract {
  /**
   * UI-only presence flag, derived from the websocket channel rather than the REST payload.
   * `isOnline` is the server's persisted value; this mirrors the live socket state.
   */
  online?: boolean;
}
