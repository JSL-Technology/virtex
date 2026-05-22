import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable, timer, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { environment } from 'apps/core/client-web/src/environments/environment';

export class AsyncValidators {
  static createEmailValidator(http: HttpClient): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      if (!control.value) {
        return of(null);
      }
      return timer(500).pipe(
        switchMap(() => http.head(`${environment.apiUrl}/common/users/exists`, {
          params: { email: control.value },
          observe: 'response'
        })),
        map(response => response.ok ? { emailExists: true } : null),
        catchError(error => {
          // 404 means it doesn't exist, which is good for registration
          if (error.status === 404) {
             return of(null);
          }
          // On other errors (e.g. 500), don't block registration, or maybe show a warning?
          // For now, let's assume if we can't check, we let it pass or fail depending on strategy.
          // Safer to not block if service is down, but security-wise maybe risky.
          // Let's return null to avoid blocking user.
          return of(null);
        })
      );
    };
  }

  static createTaxIdValidator(http: HttpClient): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
       if (!control.value) {
        return of(null);
      }
      return timer(500).pipe(
        switchMap(() => http.head(`${environment.apiUrl}/common/organizations/exists`, {
          params: { taxId: control.value },
          observe: 'response'
        })),
        map(response => response.ok ? { taxIdExists: true } : null),
        catchError(error => {
           if (error.status === 404) {
             return of(null);
          }
          return of(null);
        })
      );
    };
  }
}
