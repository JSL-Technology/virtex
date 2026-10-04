import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router, UrlTree } from '@angular/router';
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
 *
 * A route marked `data: { allowSignedIn: true }` is let through either way. The payment
 * confirmation is one: someone already signed in who adds another company comes back from Stripe
 * to it, and sending them to the app instead left the payment unconfirmed from their side.
 */
export const publicGuard: CanActivateFn = (route?: ActivatedRouteSnapshot): Observable<boolean | UrlTree> | boolean => {
  if (route?.data?.['allowSignedIn'] === true) return true;
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.resolveSession().pipe(
    map((isAuthenticated) => (isAuthenticated ? router.createUrlTree(['/overview']) : true)),
  );
};
