import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth';
import { AuthStatus } from '../../shared/enums/auth-status.enum';

export const permissionsGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const required = route.data['permissions'] as string[] | undefined;
  if (!required?.length) return true;

  const decide = () =>
    authService.hasPermissions(required)
      ? true
      : router.createUrlTree(['/unauthorized'], { queryParams: { url: state.url } });

  // H-07 FIX: If auth state is still pending (e.g. after a hard refresh or token
  // rotation), wait for checkAuthStatus() to settle before evaluating permissions.
  // Evaluating synchronously while pending can falsely redirect to /unauthorized
  // because the user object has not been loaded yet.
  // (OWASP ASVS V4 Access Control; CWE-362 client-state race)
  if (authService.authStatus() === AuthStatus.pending) {
    return authService.checkAuthStatus().pipe(map(() => decide()));
  }

  return decide();
};
