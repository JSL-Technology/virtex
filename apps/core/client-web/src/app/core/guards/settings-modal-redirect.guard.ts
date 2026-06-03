import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

/**
 * Intercepts direct navigation to /settings/* and re-routes it to the modal outlet
 * over the dashboard, so settings always renders as a modal overlay.
 */
export const settingsModalRedirectGuard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
  const router = inject(Router);

  // Extract the path segments after /settings
  const pathAfterSettings = state.url
    .replace(/^\/settings\/?/, '')
    .split('?')[0]
    .split('#')[0];

  const segments = pathAfterSettings
    ? pathAfterSettings.split('/').filter(Boolean)
    : [];

  const modalPath: (string | object)[] = ['settings', ...segments];

  router.navigate([{ outlets: { primary: ['dashboard'], modal: modalPath } }]);
  return false;
};
