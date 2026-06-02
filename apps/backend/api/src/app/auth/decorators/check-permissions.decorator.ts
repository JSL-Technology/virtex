
import { applyDecorators, UseGuards, SetMetadata } from '@nestjs/common';
import { PermissionsGuard, PermissionOrPolicy } from '../guards/permissions/permissions.guard';

export const PERMISSIONS_KEY = 'permissions';

export function CheckPermissions(...permissions: PermissionOrPolicy[]) {
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(PermissionsGuard),
  );
}