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

interface StepUpChallenge {
  factor: StepUpFactor;
  ssoStartPath?: string;
  idpName?: string;
}

/** Marker left behind before leaving for the identity provider, read on the way back. */
const RESUME_KEY = 'step_up_pending_scope';

@Injectable({
  providedIn: 'root',
})
export class StepUpService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/auth`;

  /**
   * Drives the whole step-up flow:
   *   0. asks whether a valid proof for this scope is already held — if so, acts immediately;
   *   1. otherwise asks the server which factor this account needs;
   *   2. opens the prompt for that factor (or, for a federated identity, hands off to the IdP);
   *   3. POSTs `/auth/step-up`;
   *   4. on success runs the sensitive action;
   *   5. closes the prompt.
   *
   * `action` never receives a token. The server delivers the step-up proof as an httpOnly cookie
   * rather than in the response body, so the browser attaches it automatically and the value
   * never enters JavaScript — where an XSS could otherwise lift a credential capable of disabling
   * 2FA, impersonating users or deleting the account.
   *
   * Step 0 is what makes federated re-authentication work at all. The IdP round-trip is a full
   * page navigation, so the closure in `action` does not survive it; the proof does, in a cookie
   * this code cannot read. Asking the server means the click the user makes on their return goes
   * straight through instead of bouncing them to the provider again.
   *
   * Step 1 is not cosmetic either. The prompt previously always asked for a password; on an
   * account with 2FA enabled the server requires a TOTP code instead, and on a federated account
   * it requires the identity provider — neither of which a password prompt can satisfy.
   */
  requireStepUp<T>(
    scope: StepUpScope,
    viewContainerRef: ViewContainerRef,
    action: () => Observable<T>,
  ): Observable<T> {
    const resultSubject = new Subject<T>();

    this.alreadyVerified(scope)
      .pipe(take(1))
      .subscribe((held) => {
        if (held) {
          // A proof for this scope is already in the browser. Nothing to prompt for.
          action().subscribe({
            next: (actionResult) => {
              resultSubject.next(actionResult);
              resultSubject.complete();
            },
            error: (err) => resultSubject.error(err),
          });
          return;
        }
        this.promptAndRun(scope, viewContainerRef, action, resultSubject);
      });

    return resultSubject.asObservable();
  }

  private promptAndRun<T>(
    scope: StepUpScope,
    viewContainerRef: ViewContainerRef,
    action: () => Observable<T>,
    resultSubject: Subject<T>,
  ): void {
    this.challenge()
      .pipe(take(1))
      .subscribe((challenge) => {
        const componentRef = viewContainerRef.createComponent(PasswordConfirmModalComponent);
        const instance = componentRef.instance;
        instance.factor = challenge.factor;
        instance.idpName = challenge.idpName ?? null;

        // Federated identity: the credential lives at the provider, so confirming means going
        // there. The current page is remembered so the server can put the user back on it.
        instance.federate.pipe(take(1)).subscribe(() => {
          try {
            sessionStorage.setItem(RESUME_KEY, scope);
          } catch {
            // Private browsing or blocked storage. The redirect still works; only the
            // "verification complete" message on the way back is lost.
          }
          const start = challenge.ssoStartPath ?? '/auth/step-up/sso';
          const base = `${environment.apiUrl}${start}`;
          const returnTo = this.currentPath();
          this.redirect(
            `${base}?scope=${encodeURIComponent(scope)}&returnTo=${encodeURIComponent(returnTo)}`,
          );
        });

        const handleConfirm = (credential: string) => {
          instance.isLoading = true;
          instance.error = null;

          const body =
            challenge.factor === 'otp'
              ? { scope, otpCode: credential }
              : { scope, password: credential };

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
                    ? challenge.factor === 'otp'
                      ? 'AUTH.STEP_UP.ERRORS.INVALID_CODE'
                      : 'AUTH.STEP_UP.ERRORS.INVALID_PASSWORD'
                    : err.status === 429
                      ? 'AUTH.STEP_UP.ERRORS.TOO_MANY_ATTEMPTS'
                      : err.status === 403
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
  }

  /**
   * Ask the server which credential it will accept.
   *
   * Falls back to the password prompt only when the call itself fails — on an account that needs
   * an OTP the server will still reject a password, so the user sees a clear error rather than a
   * silent no-op.
   */
  private challenge(): Observable<StepUpChallenge> {
    return this.http
      .get<StepUpChallenge>(`${this.apiUrl}/step-up/challenge`, { withCredentials: true })
      .pipe(
        switchMap((res) => of<StepUpChallenge>({ ...res, factor: res.factor ?? 'password' })),
        catchError(() => of<StepUpChallenge>({ factor: 'password' })),
      );
  }

  /**
   * Whether a proof for this scope is already held.
   *
   * Reading it does not spend it: single-use scopes are burned by the guard on the action's own
   * route, never by this probe. A failure answers "no", which costs the user one prompt.
   */
  private alreadyVerified(scope: StepUpScope): Observable<boolean> {
    return this.http
      .get<{ valid: boolean }>(`${this.apiUrl}/step-up/status`, {
        params: { scope },
        withCredentials: true,
      })
      .pipe(
        switchMap((res) => of(Boolean(res?.valid))),
        catchError(() => of(false)),
      );
  }

  /**
   * Leaving the application, isolated behind a method.
   *
   * `window.location` is not reliably redefinable under jsdom, so a test that wants to assert
   * *where* the user is sent has to be able to intercept it here. Keeping the seam explicit is
   * also what makes the redirect target reviewable in one place.
   */
  protected redirect(url: string): void {
    window.location.assign(url);
  }

  /** The path the user is on, for the server to return them to. */
  protected currentPath(): string {
    return `${window.location.pathname}${window.location.search}`;
  }

  /**
   * The scope the user left to verify at their identity provider, if they are coming back from
   * one. Consumed on read, so the notice appears once.
   */
  consumePendingScope(): StepUpScope | null {
    try {
      const scope = sessionStorage.getItem(RESUME_KEY);
      if (scope) sessionStorage.removeItem(RESUME_KEY);
      return (scope as StepUpScope) ?? null;
    } catch {
      return null;
    }
  }
}
