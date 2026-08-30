import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { PermissionsGuard, type PermissionOrPolicy } from '../guards/permissions/permissions.guard';
import { PERMISSIONS_KEY } from './permissions.constants';

export { PERMISSIONS_KEY };

/**
 * Require one or more permissions — or an ABAC policy — to reach a route.
 *
 * The decorator applies `PermissionsGuard` itself. It used to be `SetMetadata` alone, which meant
 * the declaration only did anything on controllers that separately remembered to list the guard
 * in `@UseGuards`. Eight of them did not, and `PermissionsGuard` is not registered as an
 * APP_GUARD either, so those routes announced a permission requirement and enforced nothing:
 * accounting period close and reopen, the inflation adjustment, consolidation, journal-entry
 * adjustments, invoice creation, financial and analytical reporting, and workflow management were
 * all reachable by any authenticated member of the tenant.
 *
 * Declaring the requirement and enforcing it are now the same act, so the two cannot come apart
 * again. Listing `PermissionsGuard` in a controller's own `@UseGuards` as well is harmless — Nest
 * de-duplicates guard classes for a given handler.
 *
 * Accepts both permission strings and policy classes so one declaration can require a permission
 * AND an ownership/tenant policy (see PermissionsGuard).
 */
export const HasPermission = (...permissions: PermissionOrPolicy[]) =>
  applyDecorators(SetMetadata(PERMISSIONS_KEY, permissions), UseGuards(PermissionsGuard));
