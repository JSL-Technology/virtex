import { AbstractControl, AsyncValidatorFn, ValidationErrors } from '@angular/forms';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, timer, of } from 'rxjs';
import { map, switchMap, catchError } from 'rxjs/operators';
import { environment } from 'apps/core/client-web/src/environments/environment';
import { IS_PUBLIC_API } from '../../core/tokens/http-context.tokens';

export class AsyncValidators {
  static createEmailValidator(http: HttpClient): AsyncValidatorFn {
    return (control: AbstractControl): Observable<ValidationErrors | null> => {
      if (!control.value) {
        return of(null);
      }
      return timer(500).pipe(
        switchMap(() => http.head(`${environment.apiUrl}/common/users/exists`, {
          params: { email: control.value },
          observe: 'response',
          context: new HttpContext().set(IS_PUBLIC_API, true),
        })),
        map(response => response.ok ? { emailExists: true } : null),
        catchError(error => {
          if (error.status === 404) {
            return of(null);
          }
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
          observe: 'response',
          context: new HttpContext().set(IS_PUBLIC_API, true),
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
