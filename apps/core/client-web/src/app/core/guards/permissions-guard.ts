import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth';

export const permissionsGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const required = route.data['permissions'] as string[] | undefined;
  if (!required?.length) return true;

  // Permissions live on the principal, so the session has to be resolved before they can be
  // judged — evaluating early reports "no permissions" for a user who simply has not loaded yet
  // and redirects them to /unauthorized (OWASP ASVS V4; CWE-362 client-state race).
  // `resolveSession()` is memoised, so this is a replayed value rather than a request.
  return authService.resolveSession().pipe(
    map(() =>
      authService.hasPermissions(required)
        ? true
        : router.createUrlTree(['/unauthorized'], { queryParams: { url: state.url } }),
    ),
  );
};
