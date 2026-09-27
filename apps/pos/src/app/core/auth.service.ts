import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, tap } from 'rxjs';
import { Observable } from 'rxjs';
import { LocaleContextContract } from '@virteex/shared/types';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { environment } from '../../environments/environment';

export interface SessionUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  organizationId: string;
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

/**
 * Minimal auth for the POS terminal: resolve the current session, log in, log out. It reuses the
 * platform's cookie session rather than holding tokens — the API sets an httpOnly session cookie on
 * login, and the interceptor attaches it (and the CSRF header) thereafter.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly locale = inject(LocaleStore);
  private readonly apiUrl = `${environment.apiUrl}/auth`;

  private readonly _user = signal<SessionUser | null>(null);
  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);

  /** Ask the server who we are. Resolves the app's initial auth state before the first route. */
  resolveSession(): Observable<boolean> {
    return this.http
      .get<{ user?: SessionUser } | SessionUser>(`${this.apiUrl}/session`, { withCredentials: true })
      .pipe(
        map((res) => (res && 'user' in res ? res.user ?? null : (res as SessionUser)) ?? null),
        tap((user) => {
          this._user.set(user);
          this.locale.setTenantContext(user?.localeContext ?? null);
          if (user?.localeContext) this.locale.setLanguage(user.localeContext.language);
        }),
        map((user) => user !== null),
        catchError(() => {
          this._user.set(null);
          return of(false);
        }),
      );
  }

  /**
   * Sign in with a password. Answers `'signed-in'`, or `'second-factor'` when the account has a
   * second factor and the server is waiting for its code (`verifySecondFactor`).
   *
   * This used to map every successful response to `true`, including the one that says "now send
   * the code" — so an account with a second factor could never use the till, which pushed shops
   * to turn the factor off for exactly the people who handle cash.
   */
  login(email: string, password: string): Observable<'signed-in' | 'second-factor'> {
    return this.http
      .post<{ require2fa?: boolean; user?: SessionUser } | SessionUser>(
        `${this.apiUrl}/login`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(
        map((res) =>
          res && 'require2fa' in res && res.require2fa ? 'second-factor' : 'signed-in',
        ),
      );
  }

  /** Complete a sign-in that is waiting for its second factor (TOTP or a backup code). */
  verifySecondFactor(code: string): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/verify-2fa`, { code }, { withCredentials: true });
  }

  private forget(): void {
    this._user.set(null);
    // The tenant's currency and timezone belonged to that session, not to this browser.
    this.locale.setTenantContext(null);
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => this.forget()),
      catchError(() => {
        this.forget();
        return of(null);
      }),
    );
  }
}
