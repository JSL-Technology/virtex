import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, map, of, tap } from 'rxjs';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SessionUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  organizationId: string;
  permissions?: string[];
}

/**
 * Minimal auth for the POS terminal: resolve the current session, log in, log out. It reuses the
 * platform's cookie session rather than holding tokens — the API sets an httpOnly session cookie on
 * login, and the interceptor attaches it (and the CSRF header) thereafter.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
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
        tap((user) => this._user.set(user)),
        map((user) => user !== null),
        catchError(() => {
          this._user.set(null);
          return of(false);
        }),
      );
  }

  login(email: string, password: string): Observable<boolean> {
    return this.http
      .post<{ user?: SessionUser } | SessionUser>(
        `${this.apiUrl}/login`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(
        // A 2FA-gated account returns without a full session; the POS terminal treats that as
        // "finish signing in on the main app" rather than implementing the whole challenge here.
        tap(() => void 0),
        map(() => true),
      );
  }

  logout(): Observable<unknown> {
    return this.http.post(`${this.apiUrl}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => this._user.set(null)),
      catchError(() => {
        this._user.set(null);
        return of(null);
      }),
    );
  }
}
