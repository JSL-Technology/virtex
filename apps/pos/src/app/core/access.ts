import { hasPermission } from '@virteex/shared/util-auth';

/**
 * Who may do what at the till. The server enforces every one of these on its own routes; the till
 * asks the same questions only to show the right screen instead of a wall of 403s.
 */
export const POS_PERMISSIONS = {
  /** Open the application at all: see the catalogue, the shift and its sales. */
  ACCESS: 'pos:view',
  /** Open and close their own shift and ring sales on it. */
  OPERATE: 'pos:operate',
  /** Supervisor: act on another cashier's shift, void sales. */
  SUPERVISE: 'pos:manage_shifts',
} as const;

export function canAccessPos(
  permissions: readonly string[] | null | undefined,
): boolean {
  return hasPermission([...(permissions ?? [])], [POS_PERMISSIONS.ACCESS]);
}

export function canOperatePos(
  permissions: readonly string[] | null | undefined,
): boolean {
  return hasPermission([...(permissions ?? [])], [POS_PERMISSIONS.OPERATE]);
}

export function canSupervisePos(
  permissions: readonly string[] | null | undefined,
): boolean {
  return hasPermission([...(permissions ?? [])], [POS_PERMISSIONS.SUPERVISE]);
}
