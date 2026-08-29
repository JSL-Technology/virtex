import { Injectable, inject, ViewContainerRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, switchMap, take, catchError } from 'rxjs';
import {
  PasswordConfirmModalComponent,
  StepUpFactor,
} from '../../shared/components/password-confirm-modal/password-confirm-modal.component';
import { environment } from '../../../environments/environment';

/**
 * Actions that require a fresh proof of identity. Mirrors `StepUpScope` on the server; the
 * server rejects a token whose scope does not match the route, so a value that drifts here fails
 * loudly rather than silently authorising the wrong thing.
 */
export enum StepUpScope {
  ENABLE_2FA = 'enable_2fa',
  DISABLE_2FA = 'disable_2fa',
  REGENERATE_BACKUP_CODES = 'regenerate_backup_codes',
  CHANGE_PASSWORD = 'change_password',
  CHANGE_EMAIL = 'change_email',
  DELETE_ACCOUNT = 'delete_account',
  MANAGE_PAYMENT = 'manage_payment',
  REVOKE_SESSION = 'revoke_session',
  IMPERSONATE = 'impersonate',
  MANAGE_ROLES = 'manage_roles',
  REGISTER_PASSKEY = 'register_passkey',
  MANAGE_USERS = 'manage_users',
  MANAGE_USER_STATUS = 'manage_user_status',
  MANAGE_USER_CREDENTIALS = 'manage_user_credentials',
}

@Injectable({
  providedIn: 'root',
})
export class StepUpService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth`;

  /**
   * Drives the whole step-up flow:
   *   1. asks the server which factor this account needs;
   *   2. opens the prompt for that factor;
   *   3. POSTs `/auth/step-up`;
   *   4. on success runs the sensitive action;
   *   5. closes the prompt.
   *
   * `action` never receives a token. The server delivers the step-up proof as an httpOnly cookie
   * rather than in the response body, so the browser attaches it automatically and the value
   * never enters JavaScript — where an XSS could otherwise lift a credential capable of disabling
   * 2FA, impersonating users or deleting the account.
   *
   * Step 1 is not cosmetic. The prompt previously always asked for a password; on an account with
   * 2FA enabled the server requires a TOTP code instead, so that prompt could not be satisfied at
   * all.
   */
  requireStepUp<T>(
    scope: StepUpScope,
    viewContainerRef: ViewContainerRef,
    action: () => Observable<T>,
  ): Observable<T> {
    const resultSubject = new Subject<T>();

    this.challengeFactor()
      .pipe(take(1))
      .subscribe((factor) => {
        const componentRef = viewContainerRef.createComponent(PasswordConfirmModalComponent);
        const instance = componentRef.instance;
        instance.factor = factor;

        const handleConfirm = (credential: string) => {
          instance.isLoading = true;
          instance.error = null;

          const body =
            factor === 'otp' ? { scope, otpCode: credential } : { scope, password: credential };

          this.http
            .post<{ success: boolean }>(`${this.apiUrl}/step-up`, body, { withCredentials: true })
            .subscribe({
              next: () => {
                instance.isLoading = false;
                // The step-up cookie is set; the browser attaches it to the next request.
                action().subscribe({
                  next: (actionResult) => {
                    resultSubject.next(actionResult);
                    resultSubject.complete();
                    componentRef.destroy();
                  },
                  error: (err) => {
                    resultSubject.error(err);
                    componentRef.destroy();
                  },
                });
              },
              error: (err) => {
                instance.isLoading = false;
                instance.error =
                  err.status === 401
                    ? factor === 'otp'
                      ? 'AUTH.STEP_UP.ERRORS.INVALID_CODE'
                      : 'AUTH.STEP_UP.ERRORS.INVALID_PASSWORD'
                    : err.status === 429 || err.status === 403
                      ? 'AUTH.STEP_UP.ERRORS.TOO_MANY_ATTEMPTS'
                      : 'AUTH.STEP_UP.ERRORS.VERIFICATION_FAILED';

                if (err.error?.remainingAttempts !== undefined) {
                  instance.remainingAttempts = err.error.remainingAttempts;
                }

                instance.credential.set('');
                instance.confirmed.pipe(take(1)).subscribe(handleConfirm);
              },
            });
        };

        instance.confirmed.pipe(take(1)).subscribe(handleConfirm);

        instance.cancelled.subscribe(() => {
          resultSubject.complete();
          componentRef.destroy();
        });
      });

    return resultSubject.asObservable();
  }

  /**
   * Ask the server which credential it will accept. Falls back to the password prompt only when
   * the call itself fails — on an account that needs an OTP the server will still reject a
   * password, so the user sees a clear error rather than a silent no-op.
   */
  private challengeFactor(): Observable<StepUpFactor> {
    return this.http
      .get<{ factor: StepUpFactor }>(`${this.apiUrl}/step-up/challenge`, { withCredentials: true })
      .pipe(
        switchMap((res) => of(res.factor ?? 'password')),
        catchError(() => of<StepUpFactor>('password')),
      );
  }
}
