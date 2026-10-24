import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  Observable,
  catchError,
  map,
  of,
  shareReplay,
  switchMap,
  tap,
  finalize,
} from 'rxjs';
import { LocaleContextContract } from '@virteex/shared/types';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { environment } from '../../environments/environment';
import { canAccessPos, canOperatePos, canSupervisePos } from './access';
import { recaptchaToken$ } from './recaptcha';

export interface SessionUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  organizationId: string;
  organization?: {
    id: string;
    legalName?: string | null;
    logoUrl?: string | null;
  } | null;
  permissions?: string[];
  /**
   * Language, locale, currency and timezone, resolved by the server for this tenant.
   *
   * The till must not infer these from the browser. A terminal on a shop counter runs whatever
   * Windows install it came with, and `Intl.NumberFormat(undefined, …)` — which is what this app
   * used — takes the BROWSER's locale, so a Dominican peso was grouped and punctuated the American
   * way on any machine that had never had its region changed.
   */
  localeContext?: LocaleContextContract;
}

/** `GET /auth/session`: always 200; "signed out" is an answer, not an error. */
interface SessionResponse {
  authenticated: boolean;
  user: SessionUser | null;
  /** Signed out, but holding a refresh token that can renew the session. */
  refreshable: boolean;
}

/** How a sign-in attempt ended. */
export type SignInOutcome = 'signed-in' | 'second-factor' | 'no-access';

/**
 * The till's sign-in, on the platform's own cookie session.
 *
 * It holds no token: the API sets httpOnly session cookies, and the interceptor attaches them and the
 * CSRF header to every request. Because the cookies are host-only and the point of sale is served on
 * the ERP's host, a person signed in to one application is signed in to the other — one identity,
 * one session, one place to revoke it.
 *
 * Access is a permission, not a separate account: anyone whose role carries `pos:view` signs in
 * here with their usual credentials; anyone else is told so and signed back out of the till (their
 * ERP session, if any, is the ERP's business and is left alone only when they never signed in here).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly locale = inject(LocaleStore);
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  private readonly _user = signal<SessionUser | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly canAccess = computed(() => canAccessPos(this._user()?.permissions));
  readonly canOperate = computed(() =>
    canOperatePos(this._user()?.permissions),
  );
  readonly canSupervise = computed(() =>
    canSupervisePos(this._user()?.permissions),
  );
  readonly displayName = computed(() => {
    const user = this._user();
    if (!user) return '';
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || user.email;
  });

  /** One renewal at a time: concurrent 401s all wait on the same refresh. */
  private refreshing$: Observable<boolean> | null = null;

  /**
   * Who are we? Renews the session first when the server says it can be renewed — an access token
   * expires long before a cashier's shift does, and a till that bounced to the sign-in screen every
   * quarter of an hour would be switched off by the shop.
   */
  resolveSession(): Observable<boolean> {
    return this.readSession().pipe(
      switchMap((res) => {
        if (res.authenticated && res.user) return of(this.adopt(res.user));
        if (res.refreshable) {
          return this.refresh().pipe(
            switchMap((renewed) => (renewed ? this.readSession() : of(null))),
            map((again) =>
              again?.authenticated && again.user
                ? this.adopt(again.user)
                : this.forget(),
            ),
          );
        }
        return of(this.forget());
      }),
      catchError(() => of(this.forget())),
    );
  }

  /**
   * Renew the access token from the refresh cookie. Shared while in flight, so a burst of expired
   * requests produces one renewal rather than one each — the second would replay a rotated token
   * and the server would revoke the whole session as stolen.
   */
  refresh(): Observable<boolean> {
    if (!this.refreshing$) {
      this.refreshing$ = this.http.post(`${this.apiUrl}/refresh`, {}).pipe(
        map(() => true),
        catchError(() => of(false)),
        finalize(() => (this.refreshing$ = null)),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.refreshing$;
  }

  /** Make sure the CSRF cookie exists before the first state-changing request (the sign-in). */
  primeCsrf(): Observable<unknown> {
    return this.readSession().pipe(catchError(() => of(null)));
  }

  /**
   * Sign in with a password. Answers `'signed-in'`, `'second-factor'` when the account has a second
   * factor and the server is waiting for its code (`verifySecondFactor`), or `'no-access'` when the
   * credentials are right but the person's role does not include the point of sale.
   */
  login(email: string, password: string): Observable<SignInOutcome> {
    return recaptchaToken$('login').pipe(
      switchMap((recaptchaToken) =>
        this.http.post<{ require2fa?: boolean } | object>(
          `${this.apiUrl}/login`,
          {
            email,
            password,
            recaptchaToken,
          },
        ),
      ),
      switchMap((res) =>
        res && 'require2fa' in res && res.require2fa
          ? of<SignInOutcome>('second-factor')
          : this.afterSignIn(),
      ),
    );
  }

  /** Complete a sign-in that is waiting for its second factor (TOTP or a backup code). */
  verifySecondFactor(code: string): Observable<SignInOutcome> {
    return this.http
      .post(`${this.apiUrl}/verify-2fa`, { code })
      .pipe(switchMap(() => this.afterSignIn()));
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/logout`, {}).pipe(
      tap(() => this.forget()),
      catchError(() => {
        this.forget();
        return of(null);
      }),
    );
  }

  /** The session ended under us (revoked, expired beyond renewal): drop it locally. */
  sessionLost(): void {
    this.forget();
  }

  private afterSignIn(): Observable<SignInOutcome> {
    return this.resolveSession().pipe(
      switchMap((ok) => {
        if (!ok) return of<SignInOutcome>('no-access');
        if (this.canAccess()) return of<SignInOutcome>('signed-in');
        // Right credentials, wrong role: the till is not theirs. Sign the session we just opened
        // back out rather than leave a session behind on a shared counter machine.
        return this.logout().pipe(map(() => 'no-access' as const));
      }),
    );
  }

  private readSession(): Observable<SessionResponse> {
    return this.http.get<SessionResponse>(`${this.apiUrl}/session`);
  }

  private adopt(user: SessionUser): boolean {
    this._user.set(user);
    this.locale.setTenantContext(user.localeContext ?? null);
    if (user.localeContext)
      this.locale.setLanguage(user.localeContext.language);
    return true;
  }

  private forget(): false {
    this._user.set(null);
    // The tenant's currency and timezone belonged to that session, not to this browser.
    this.locale.setTenantContext(null);
    return false;
  }
}
