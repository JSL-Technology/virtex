import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot } from '@angular/router';

/**
 * Intercepts direct navigation to /settings/* and re-routes it to /overview
 * with a hash fragment so the settings modal opens as an overlay.
 */
export const settingsModalRedirectGuard: CanActivateFn = (_route, state: RouterStateSnapshot) => {
  const router = inject(Router);

  // Extract the path segment after /settings (e.g. /settings/my-profile → my-profile)
  const pathAfterSettings = state.url
    .replace(/^\/settings\/?/, '')
    .split('?')[0]
    .split('#')[0];

  const section = pathAfterSettings
    ? pathAfterSettings.split('/').filter(Boolean)[0] || 'my-profile'
    : 'my-profile';

  router.navigate(['/overview'], { fragment: 'settings/' + section });
  return false;
};
