import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth';

/**
 * Keeps an already-signed-in user off the sign-in screens, sending them to the app instead.
 *
 * Declared as `canActivateChild` on the `auth` route, which Angular evaluates once per nested
 * child level — so reaching `/{lang}/auth/login` runs it twice. That was two extra session
 * round-trips per visit to the login page; against the memoised `resolveSession()` it is two
 * synchronous reads of the same answer.
 */
export const publicGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.resolveSession().pipe(
    map((isAuthenticated) => (isAuthenticated ? router.createUrlTree(['/overview']) : true)),
  );
};
