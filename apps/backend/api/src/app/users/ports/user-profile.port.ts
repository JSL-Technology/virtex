import type { User } from '../entities/user.entity/user.entity';

/**
 * The user-lookup surface OrganizationsController needs to hydrate the full user profile after
 * an org switch. Defined in users/ because the method it abstracts belongs to UsersService.
 *
 * OrganizationsController injects this port instead of the full UsersService, so
 * OrganizationsModule does not depend on UsersModule's internals.
 */
export abstract class UserProfilePort {
  /**
   * Load the user with their roles, security settings, and current-organization relation — the
   * full principal object the auth system needs after a context switch.
   */
  abstract findUserByIdForAuth(id: string): Promise<User | null>;
}
