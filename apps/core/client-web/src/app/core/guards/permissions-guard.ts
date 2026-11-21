import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth';
import type { SaasFeatureKey } from '@virtex/shared/types';

/** Where a refused navigation is sent. Declared at the top level, outside the guarded shell. */
const DENIED_ROUTE = '/unauthorized';

export const permissionsGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const required = route.data['permissions'] as string[] | undefined;
  // The plan capability the window needs (`ModuleRoute.feature`): an address typed or bookmarked
  // does not open what the menu does not offer (IA-02).
  const feature = route.data['feature'] as SaasFeatureKey | undefined;
  if (!required?.length && !feature) return true;

  // Permissions live on the principal, so the session has to be resolved before they can be
  // judged — evaluating early reports "no permissions" for a user who simply has not loaded yet
  // and redirects them to /unauthorized (OWASP ASVS V4; CWE-362 client-state race).
  // `resolveSession()` is memoised, so this is a replayed value rather than a request.
  return authService.resolveSession().pipe(
    map(() => {
      const permitted = !required?.length || authService.hasPermissions(required);
      const inPlan = !feature || authService.hasFeature(feature);
      if (permitted && inPlan) return true;

      // Never redirect to the page we are already on.
      //
      // A guard that answers a refusal with a UrlTree the router then refuses again is an
      // unbounded navigation loop — Angular caps `redirectTo` in the route config, but not a
      // UrlTree returned from a guard — and it freezes the tab rather than failing. The denied
      // route is guardless and outside the shell precisely so this cannot happen; this check is
      // the second lock on the same door, so a future misconfiguration degrades to a blocked
      // navigation instead of a hung browser.
      if (state.url.split('?')[0] === DENIED_ROUTE) return false;

      // A missing permission is said first: who may not open it learns nothing about the plan.
      return router.createUrlTree([DENIED_ROUTE], {
        queryParams: { url: state.url, ...(permitted && feature ? { feature } : {}) },
      });
    }),
  );
};
