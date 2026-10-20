import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, of } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * The till needs a session AND the point-of-sale permission.
 *
 * A person who arrives signed in from the ERP without that permission is sent to the sign-in
 * screen with the reason, and NOT signed out: the session is the ERP's too, and closing it from
 * here would sign them out of the application they actually work in.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const decide = () =>
    !auth.isAuthenticated()
      ? router.createUrlTree(['/login'])
      : auth.canAccess() || router.createUrlTree(['/login'], { queryParams: { reason: 'no_access' } });
  if (auth.isAuthenticated()) return of(decide());
  return auth.resolveSession().pipe(map(() => decide()));
};

/** Someone already signed in with access has nothing to do on the sign-in screen. */
export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // An explicit reason (no access, expired) is a message to show, not a page to skip.
  if (route.queryParamMap.has('reason')) return true;
  const decide = () => (auth.isAuthenticated() && auth.canAccess() ? router.createUrlTree(['/']) : true);
  if (auth.isAuthenticated()) return decide();
  return auth.resolveSession().pipe(map(() => decide()));
};
