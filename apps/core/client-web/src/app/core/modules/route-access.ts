import type { SaasFeatureKey } from '@virtex/shared/types';
import { AUTHENTICATED_ONLY } from './module-manifest';

/** What opening a window takes: a permission, and — for a step-up capability — the plan's feature. */
export interface AccessRequirement {
  permission: string;
  feature?: SaasFeatureKey | null;
}

/** The two questions the access rule asks, answered by `AuthService` from the session. */
export interface AccessHolder {
  hasPermissions(permissions: string[]): boolean;
  hasFeature(feature: SaasFeatureKey): boolean;
}

/**
 * Why a window cannot be opened, or null when it can.
 *
 * `permission` first: someone without the permission learns nothing about the plan from being
 * refused. `plan` means the person may do this and the company's plan does not include it — a
 * different answer, with a different remedy (an administrator changes plan, not a role).
 *
 * The one rule for every place that offers or opens a window: the module panel, the rail, the
 * reports hub, the overview, the tab registry and the router guard. They each asked the permission
 * alone, so the menu offered a company on the entry plan every AI screen, consolidation and the
 * manager's report, and each answered 403 when opened (IA-01, IA-02, TES-20).
 */
export function accessDenial(holder: AccessHolder, requirement: AccessRequirement): 'permission' | 'plan' | null {
  if (requirement.permission !== AUTHENTICATED_ONLY && !holder.hasPermissions([requirement.permission])) return 'permission';
  if (requirement.feature && !holder.hasFeature(requirement.feature)) return 'plan';
  return null;
}

/** Whether a window can be opened: the permission held and, when it names one, the feature in the plan. */
export function canAccess(holder: AccessHolder, requirement: AccessRequirement): boolean {
  return accessDenial(holder, requirement) === null;
}
