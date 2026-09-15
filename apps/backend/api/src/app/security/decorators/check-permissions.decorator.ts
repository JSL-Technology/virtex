import { HasPermission, PERMISSIONS_KEY } from './permissions.decorator';

export { PERMISSIONS_KEY };

/**
 * Historical alias of {@link HasPermission}.
 *
 * The two decorators were separate implementations of the same idea and had diverged: this one
 * applied `PermissionsGuard`, the other did not. They are now one function under two names, kept
 * because controllers import both spellings. New code should use `HasPermission`.
 */
export const CheckPermissions = HasPermission;
