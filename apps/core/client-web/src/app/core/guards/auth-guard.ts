// ../app/core/guards/auth.guard.ts

import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { AuthService } from '../services/auth';
import { LanguageService } from '../services/language';
import { map, take } from 'rxjs/operators';
// import { Observable } from 'rxjs';
import { Observable, of } from 'rxjs';



export const authGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const languageService = inject(LanguageService);

  
  if (authService.isAuthenticated()) {
    return of(true);
  }

  return authService.checkAuthStatus().pipe(
    take(1),
    map(isAuthenticated => {
      if (isAuthenticated) {
        return true;
      }
      const lang = languageService.currentLang() || 'es';
      return router.createUrlTree(['/', lang, 'auth', 'login']);
    })
  );
};
