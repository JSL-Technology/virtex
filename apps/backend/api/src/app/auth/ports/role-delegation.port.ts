import { AuthenticatedUser } from '../../security/principal';

/**
 * "May this actor hand out this role?", asked by a module that is not `roles`.
 *
 * The rule itself lives in `RolesService.assertCanAssignRole`: nobody delegates rights they do not
 * hold, and a role carrying `'*'` or any platform permission is refused outright. It was applied
 * in the two places `users` assigns a role, and the comment there asserted those were the only two.
 *
 * `IdentityProvider.defaultRoleId` was a third — every SSO-provisioned user is created with that
 * role — and it lives in `auth`. This port is how `auth` asks the question without importing
 * `roles`, in the same shape as `SessionInvalidatorPort` and `MfaPolicyPort`. Taking an id rather
 * than a `Role` keeps the entity on the owning side of the boundary.
 */
export abstract class RoleDelegationPort {
  /**
   * Throws unless `actor` may assign the role `roleId` within `organizationId`.
   *
   * Also throws when the role does not exist in that tenant, so a caller cannot point at a role id
   * belonging to somebody else.
   */
  abstract assertCanAssignRoleById(
    actor: AuthenticatedUser,
    roleId: string,
    organizationId: string,
  ): Promise<void>;
}
