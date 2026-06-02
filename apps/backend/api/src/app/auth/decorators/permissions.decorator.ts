
import { SetMetadata } from '@nestjs/common';
import type { PermissionOrPolicy } from '../guards/permissions/permissions.guard';

export const PERMISSIONS_KEY = 'permissions';

// Accepts both static permission strings and ABAC policy classes so a single declaration
// can require a permission AND an ownership/tenant policy (see PermissionsGuard).
export const HasPermission = (...permissions: PermissionOrPolicy[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);