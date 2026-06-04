
import { Injectable, inject, ViewContainerRef, ComponentRef, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, throwError } from 'rxjs';
import { catchError, map, switchMap, tap, take } from 'rxjs/operators';
import { PasswordConfirmModalComponent } from '../../shared/components/password-confirm-modal/password-confirm-modal.component';
import { environment } from '../../../environments/environment';

export enum StepUpScope {
  ENABLE_2FA = 'enable_2fa',
  DISABLE_2FA = 'disable_2fa',
  REGENERATE_BACKUP_CODES = 'regenerate_backup_codes',
  CHANGE_PASSWORD = 'change_password',
  CHANGE_EMAIL = 'change_email',
  DELETE_ACCOUNT = 'delete_account',
  MANAGE_PAYMENT = 'manage_payment',
  REVOKE_SESSION = 'revoke_session',
}

@Injectable({
  providedIn: 'root'
})
export class StepUpService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth`;

  /**
   * requireStepUp handles the entire flow:
   * 1. Opens the password confirmation modal.
   * 2. Calls /auth/verify-password.
   * 3. On success, executes the provided action with the step-up token.
   * 4. Closes the modal.
   */
  requireStepUp<T>(
    scope: StepUpScope,
    viewContainerRef: ViewContainerRef,
    action: (token: string) => Observable<T>
  ): Observable<T> {
    const resultSubject = new Subject<T>();

    const componentRef = viewContainerRef.createComponent(PasswordConfirmModalComponent);
    const instance = componentRef.instance;

    const handleConfirm = (password: string) => {
      instance.isLoading = true;
      instance.error = null;

      this.http.post<{ stepUpToken: string }>(`${this.apiUrl}/verify-password`, {
        password,
        scope
      }, { withCredentials: true }).subscribe({
        next: (res) => {
          instance.isLoading = false;
          // Execute the sensitive action with the token
          action(res.stepUpToken).subscribe({
            next: (actionResult) => {
              resultSubject.next(actionResult);
              resultSubject.complete();
              componentRef.destroy();
            },
            error: (err) => {
              // Action failed (e.g. server-side token validation failed)
              resultSubject.error(err);
              componentRef.destroy();
            }
          });
        },
        error: (err) => {
          instance.isLoading = false;
          instance.error = err.status === 401 ? 'AUTH.STEP_UP.ERRORS.INVALID_PASSWORD' : 'AUTH.STEP_UP.ERRORS.VERIFICATION_FAILED';

          if (err.status === 429) {
            instance.error = 'AUTH.STEP_UP.ERRORS.TOO_MANY_ATTEMPTS';
          }

          // If the backend returns remaining attempts, we can show it
          if (err.error?.remainingAttempts !== undefined) {
              instance.remainingAttempts = err.error.remainingAttempts;
          }

          // Reset password for next attempt
          instance.password.set('');

          // Allow another attempt
          instance.confirm.pipe(take(1)).subscribe(handleConfirm);
        }
      });
    };

    instance.confirm.pipe(take(1)).subscribe(handleConfirm);

    instance.cancel.subscribe(() => {
      resultSubject.complete();
      componentRef.destroy();
    });

    return resultSubject.asObservable();
  }
}
