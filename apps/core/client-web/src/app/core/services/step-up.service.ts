import { Injectable, inject, ViewContainerRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, of, switchMap, take, catchError, finalize, shareReplay } from 'rxjs';
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
  REVEAL_SESSION_ORIGIN = 'reveal_session_origin',
  MANAGE_SSO = 'manage_sso',
  PUBLISH_EXTENSION = 'publish_extension',
  APPROVE_PAYROLL = 'approve_payroll',
  VIEW_PAYROLL_DATA = 'view_payroll_data',
  REBUILD_ANALYTICAL_VIEW = 'rebuild_analytical_view',
  MANAGE_COMPENSATION = 'manage_compensation',
  MOVE_FUNDS = 'move_funds',
  MANAGE_BANK_ACCOUNTS = 'manage_bank_accounts',
}

/**
 * Mirrors `SINGLE_USE_SCOPES` on the server: a proof for these is spent by the action it
 * authorises, so two actions need two proofs and their prompts cannot be shared.
 */
export const SINGLE_USE_SCOPES: ReadonlySet<StepUpScope> = new Set([
  StepUpScope.DISABLE_2FA,
  StepUpScope.REGENERATE_BACKUP_CODES,
  StepUpScope.CHANGE_PASSWORD,
  StepUpScope.CHANGE_EMAIL,
  StepUpScope.DELETE_ACCOUNT,
  StepUpScope.MANAGE_PAYMENT,
  StepUpScope.IMPERSONATE,
  StepUpScope.REVOKE_SESSION,
  StepUpScope.REGISTER_PASSKEY,
  StepUpScope.ENABLE_2FA,
  StepUpScope.MANAGE_ROLES,
  StepUpScope.REVEAL_SESSION_ORIGIN,
  StepUpScope.MANAGE_SSO,
  StepUpScope.PUBLISH_EXTENSION,
  StepUpScope.APPROVE_PAYROLL,
  StepUpScope.REBUILD_ANALYTICAL_VIEW,
  StepUpScope.MOVE_FUNDS,
  StepUpScope.MANAGE_BANK_ACCOUNTS,
]);

/**
 * The message for a failed verification.
 *
 * A wrong password is now a 400 with `STEP_UP_INVALID_CREDENTIALS` (it used to be a 401, which
 * the session layer mistook for expiry — QA A-01); 401 is still read for older servers.
 */
export function stepUpErrorKey(
  err: { status?: number; error?: { code?: unknown } },
  factor: StepUpFactor,
): string {
  const invalid = err?.error?.code === 'STEP_UP_INVALID_CREDENTIALS' || err?.status === 401;
  if (invalid) {
    return factor === 'otp' ? 'auth.step_up.errors.invalid_code' : 'auth.step_up.errors.invalid_password';
  }
  if (err?.status === 429 || err?.status === 403) return 'auth.step_up.errors.too_many_attempts';
  return 'auth.step_up.errors.verification_failed';
}

/** The error keys with which the server says "this request needs a proof you do not hold". */
export const STEP_UP_CHALLENGE_KEYS: ReadonlySet<string> = new Set([
  'auth.step_up_authentication_required',
  'auth.invalid_or_expired_step_up_token',
  'auth.invalid_step_up_token_scope',
  'auth.step_up_token_already_used',
  'auth.malformed_step_up_token',
]);

/**
 * The scope a 401 is asking for, when it is a step-up challenge the client can answer.
 *
 * The server names the scope in the error's params. A key the client does not know is not
 * answered: a prompt for an unknown scope could only obtain a proof the route will refuse.
 */
export function stepUpScopeOf(error: { status?: number; error?: unknown }): StepUpScope | null {
  if (error?.status !== 401) return null;
  const body = (error.error ?? {}) as { messageKey?: unknown; params?: { scope?: unknown } };
  if (!STEP_UP_CHALLENGE_KEYS.has(String(body.messageKey ?? ''))) return null;
  const scope = String(body.params?.scope ?? '');
  return (Object.values(StepUpScope) as string[]).includes(scope) ? (scope as StepUpScope) : null;
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
   * Where the prompt is drawn when it is raised by the HTTP layer rather than by a screen.
   *
   * Screens that know an action is guarded ask for the proof up front and pass their own
   * container. Everything else — a guarded route a screen did not know about — is answered by
   * `stepUpInterceptor`, which has no container of its own; the root component registers one.
   */
  private host: ViewContainerRef | null = null;

  registerHost(host: ViewContainerRef): void {
    this.host = host;
  }

  get defaultHost(): ViewContainerRef | null {
    return this.host;
  }

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

    const run = () =>
      action().subscribe({
        next: (actionResult) => resultSubject.next(actionResult),
        error: (err) => resultSubject.error(err),
        complete: () => resultSubject.complete(),
      });

    this.alreadyVerified(scope)
      .pipe(take(1))
      .subscribe((held) => {
        if (held) {
          // A proof for this scope is already in the browser. Nothing to prompt for.
          run();
          return;
        }
        this.proofFor(scope, viewContainerRef).subscribe((proven) => {
          if (proven) run();
          else resultSubject.complete();
        });
      });

    return resultSubject.asObservable();
  }

  /**
   * One prompt per scope at a time.
   *
   * A screen that fires two guarded requests in parallel — a dashboard, a detail page with several
   * panels — used to open two dialogs stacked on top of each other, and the user had to type the
   * password twice for what they experienced as one action (QA A-02). Requests for the SAME
   * reusable scope now share the in-flight prompt and all proceed once it succeeds. A single-use
   * scope cannot be shared (each action spends its own proof), so its prompts are queued one
   * after another instead of stacked.
   */
  private readonly inflight = new Map<StepUpScope, Observable<boolean>>();

  private proofFor(scope: StepUpScope, host: ViewContainerRef): Observable<boolean> {
    const existing = this.inflight.get(scope);
    if (existing && !SINGLE_USE_SCOPES.has(scope)) return existing;

    const prompt$ = (existing ?? of(true)).pipe(
      take(1),
      // Queued behind a previous single-use prompt: whatever it resolved to, this action needs its
      // own proof.
      switchMap(() => this.prompt(scope, host)),
      finalize(() => {
        if (this.inflight.get(scope) === shared$) this.inflight.delete(scope);
      }),
    );
    const shared$ = prompt$.pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.inflight.set(scope, shared$);
    return shared$;
  }

  /** Show the prompt and obtain the proof. Emits `true` once proven, `false` if cancelled. */
  private prompt(scope: StepUpScope, viewContainerRef: ViewContainerRef): Observable<boolean> {
    return new Observable<boolean>((subscriber) => {
      this.challenge()
        .pipe(take(1))
        .subscribe((challenge) => {
          const componentRef = viewContainerRef.createComponent(PasswordConfirmModalComponent);
          const instance = componentRef.instance;
          instance.factor = challenge.factor;
          instance.idpName = challenge.idpName ?? null;
          const finish = (proven: boolean) => {
            componentRef.destroy();
            subscriber.next(proven);
            subscriber.complete();
          };

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
                // The step-up cookie is set; the browser attaches it to the next request.
                next: () => finish(true),
                error: (err) => {
                  instance.isLoading = false;
                  instance.error = stepUpErrorKey(err, challenge.factor);

                  if (err.error?.remainingAttempts !== undefined) {
                    instance.remainingAttempts = err.error.remainingAttempts;
                  }

                  // The dialog stays open: a mistyped password is corrected, not a reason to
                  // abandon the action.
                  instance.credential.set('');
                  instance.confirmed.pipe(take(1)).subscribe(handleConfirm);
                },
              });
          };

          instance.confirmed.pipe(take(1)).subscribe(handleConfirm);
          instance.cancelled.pipe(take(1)).subscribe(() => finish(false));
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
