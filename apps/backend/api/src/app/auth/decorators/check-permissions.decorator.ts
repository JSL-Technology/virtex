
import { applyDecorators, UseGuards, SetMetadata } from '@nestjs/common';
import { PermissionsGuard } from '../guards/permissions/permissions.guard';
import { Permission } from '../shared/permissions';

export const PERMISSIONS_KEY = 'permissions';

export function CheckPermissions(...permissions: Permission[]) {
  return applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(PermissionsGuard),
  );
}