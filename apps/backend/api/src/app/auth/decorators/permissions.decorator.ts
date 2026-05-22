
import { SetMetadata } from '@nestjs/common';
import { Permission } from '../shared/permissions';

export const PERMISSIONS_KEY = 'permissions';
export const HasPermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);