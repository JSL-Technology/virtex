import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpContext } from '@angular/common/http';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  map,
  shareReplay,
  switchMap,
  tap,
  of,
  take,
  firstValueFrom,
} from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

import { API_URL } from '../tokens/api-url.token';
import { RegisterPayload } from '../../shared/interfaces/register-payload.interface';
import { User } from '../../shared/interfaces/user.interface';
import { LoginCredentials } from '../../shared/interfaces/login-credentials.interface';
import { AuthStatus } from '../../shared/enums/auth-status.enum';
import { UserStatus } from '../../shared/enums/user-status.enum';
import { UserPayload } from '../../shared/interfaces/user-payload.interface';
import { NotificationService } from './notification';
import { WebSocketService } from './websocket.service';
import { ModalService } from '../../shared/service/modal.service';
import { ErrorHandlerService } from './error-handler.service';
import { IS_PUBLIC_API } from '../tokens/http-context.tokens';
import { readCsrfCookie } from '../auth/csrf-token';
import { hasPermission } from '@virteex/shared/util-auth';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService } from './language';

// H-11 FIX: Backend intentionally omits accessToken/refreshToken from the response body —
// tokens are delivered exclusively via httpOnly cookies. Removing them from the interface
// prevents future developers from "fixing" the type by re-exposing tokens in the body
// (OWASP ASVS 1.5.3; CWE-710).
interface LoginResponse {
  user: User;
}

// H-03 FIX: tempToken removed — pending session ID is delivered only via httpOnly cookie.
interface TwoFactorRequiredResponse {
  require2fa: boolean;
  message: string;
}

type LoginResult = { user: User } | TwoFactorRequiredResponse;

/**
 * What `GET /auth/session` answers. See the endpoint's own documentation for why every field is
 * needed: together they let the client know the session state without probing for it.
 */
interface SessionSnapshot {
  authenticated: boolean;
  user: User | null;
  /** Whether `POST /auth/refresh` can succeed. Never call it when this is false. */
  refreshable: boolean;
}

function isTwoFactorRequired(res: LoginResult): res is TwoFactorRequiredResponse {
    return (res as TwoFactorRequiredResponse).require2fa === true;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);
  private notificationService = inject(NotificationService);
  private webSocketService = inject(WebSocketService);
  private errorHandlerService = inject(ErrorHandlerService);
  private languageService = inject(LanguageService);
  private translate = inject(TranslateService);
  private readonly baseUrl = inject(API_URL);

  // URL base de tu API de autenticación.
  private readonly apiUrl = `${this.baseUrl}/auth`;

  // --- Estado Reactivo con Signals ---

  // Almacena la información del usuario actual. Privado para controlar su modificación.
  private _currentUser = signal<User | null>(null);
  // Almacena el estado actual de la autenticación.
  private _authStatus = signal<AuthStatus>(AuthStatus.pending);
  /**
   * The session resolution for this application load — the single source of truth, and the only
   * thing that ever issues a session request.
   *
   * It is a memoised observable rather than a method that fetches, because the old design had no
   * memo at all: `checkAuthStatus()` re-issued the network call on every guard evaluation AND
   * reset the status back to `pending` as it started, which defeated the very caching the guards
   * were written to do. A single page load resolved the session three times over — once from the
   * app initializer and twice more from `canActivateChild`, which Angular runs once per nested
   * child level — each time with a failed request behind it.
   *
   * Every path that establishes or ends a session replaces this with an already-settled
   * `of(true)` / `of(false)`, so the memo and the signals can never disagree, and so a guard
   * evaluated after bootstrap resolves synchronously without touching the network.
   */
  private sessionResolution: Observable<boolean> | null = null;

  /** Guards `listenForForcedLogout` against stacking a new socket subscription per sign-in. */
  private forcedLogoutListenerAttached = false;

  // --- Selectores Públicos (Computed Signals) ---

  // Expone el usuario actual de forma pública y de solo lectura.
  public readonly currentUser = computed(() => this._currentUser());
  // Expone el estado de autenticación actual de forma pública y de solo lectura.
  public readonly authStatus = computed(() => this._authStatus());
  // Un selector booleano para verificar fácilmente si el usuario está autenticado.
  public readonly isAuthenticated = computed(
    () => this._authStatus() === AuthStatus.authenticated
  );

  // Compatibilidad con código legado usando Observables derivados de Signals
  public isAuthenticated$ = toObservable(this.isAuthenticated);
  public user$ = toObservable(this.currentUser);

  private modalService = inject(ModalService);


  constructor() {
    this.listenForForcedLogout();
  }

  private listenForForcedLogout(): void {
    // Attached once for the lifetime of the service. It used to be re-invoked on every sign-in
    // and on every status check, stacking one more `force-logout` subscription each time — so a
    // single forced logout eventually opened one modal per past re-invocation.
    if (this.forcedLogoutListenerAttached) return;
    this.forcedLogoutListenerAttached = true;

    // Espera a que la conexión esté lista
    this.webSocketService.connectionReady$.pipe(take(1)).subscribe(() => {
      this.webSocketService
        .listen<{ reason: string }>('force-logout')
        .subscribe((data) => {
          this.logout();
          this.modalService
            .open({
              title: 'Sesión Terminada',
              message: data.reason,
              confirmText: 'Aceptar',
            })
            // Subscribed only to open the modal; the session is already gone, so there is
            // nothing to do when it closes.
            ?.onClose$.subscribe();
        });
    });
  }

  /**
   * ✅ NUEVO Y CORREGIDO: Verifica si el usuario actual tiene un conjunto de permisos.
   * Soporta wildcards (ej: 'sales.*' permite 'sales.create').
   * @param requiredPermissions Los permisos requeridos para realizar una acción.
   * @returns `true` si el usuario tiene todos los permisos, `false` de lo contrario.
   */
  hasPermissions(requiredPermissions: string[]): boolean {
    const user = this.currentUser();
    return hasPermission(user?.permissions, requiredPermissions);
  }

  /**
   * Refresca el token de acceso utilizando el token de refresco (almacenado en una cookie segura).
   * @returns Un observable que, al completarse, actualiza el estado de autenticación.
   */
  // H5 FIX: Refresh must be POST (state-changing) — backend now requires POST + CSRF.
  refreshAccessToken(): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.apiUrl}/refresh`, {}, {
        withCredentials: true,
        context: new HttpContext().set(IS_PUBLIC_API, true)
      })
      .pipe(
        tap((response) => {
          if (response?.user) {
            this.applyAuthenticated(response.user);
          }
        }),
      );
  }

  /**
   * Envía las credenciales del usuario al backend para iniciar sesión.
   * @param credentials Objeto con email, password y recaptchaToken.
   * @returns Un observable que emite el objeto User en caso de éxito.
   */
  login(credentials: LoginCredentials): Observable<User | { require2fa: boolean }> {
    const url = `${this.apiUrl}/login`;
    return this.http
      .post<LoginResult>(url, credentials, {
        withCredentials: true,
        context: new HttpContext().set(IS_PUBLIC_API, true)
      })
      .pipe(
        tap((response) => {
          if (isTwoFactorRequired(response)) {
             // Do not set authenticated yet; pending session cookie set by server
             return;
          }
          if (response.user) {
             this.applyAuthenticated(response.user);
          }
        }),
        map((response) => {
            if (isTwoFactorRequired(response)) {
                // H-03 FIX: No tempToken — pending session is tracked server-side via httpOnly cookie.
                return { require2fa: true };
            }
            return (response as LoginResponse).user;
        }),
        catchError((err) => this.errorHandlerService.handleError('login', err))
      );
  }

  // H-03 FIX: No tempToken parameter — the server reads the pendingId from the httpOnly cookie.
  verify2fa(code: string): Observable<User> {
      return this.http.post<LoginResponse>(`${this.apiUrl}/verify-2fa`, { code }, {
          withCredentials: true,
          context: new HttpContext().set(IS_PUBLIC_API, true)
      }).pipe(
          tap((response) => this.applyAuthenticated(response.user)),
          map((response) => response.user),
          catchError((err) => this.errorHandlerService.handleError('verify2fa', err))
      );
  }

  sendPhoneOtp(phoneNumber: string): Observable<{ message: string }> {
      return this.http.post<{ message: string }>(`${this.apiUrl}/send-phone-otp`, { phoneNumber });
  }

  verifyPhoneOtp(code: string, phoneNumber: string): Observable<{ message: string }> {
      return this.http.post<{ message: string }>(`${this.apiUrl}/verify-phone`, { code, phoneNumber });
  }

  sendPublicVerification(target: string, type: string, recaptchaToken?: string): Observable<{ message: string }> {
    const body: Record<string, string> = { target, type };
    if (recaptchaToken) body['recaptchaToken'] = recaptchaToken;
    return this.http.post<{ message: string }>(`${this.apiUrl}/send-public-verification`, body, {
      context: new HttpContext().set(IS_PUBLIC_API, true),
    });
  }

  verifyPublicCode(target: string, type: string, code: string, recaptchaToken?: string): Observable<{ message: string; preVerifiedToken: string }> {
    const body: Record<string, string> = { target, type, code };
    if (recaptchaToken) body['recaptchaToken'] = recaptchaToken;
    return this.http.post<{ message: string; preVerifiedToken: string }>(`${this.apiUrl}/verify-public-code`, body, {
      context: new HttpContext().set(IS_PUBLIC_API, true),
    });
  }

  confirmEmailMagicLink(token: string): Observable<{ preVerifiedToken: string }> {
    return this.http.post<{ preVerifiedToken: string }>(`${this.apiUrl}/confirm-email-magic-link`, { token }, {
      context: new HttpContext().set(IS_PUBLIC_API, true)
    });
  }

  /**
   * Home Realm Discovery: ask the backend whether an enterprise SSO connection exists for the
   * email's domain. Returns the absolute start URL to redirect the browser to when it does.
   */
  discoverSso(email: string): Observable<{ ssoAvailable: boolean; idpName?: string; startUrl?: string }> {
    return this.http.post<{ ssoAvailable: boolean; idpName?: string; startUrl?: string }>(
      `${this.apiUrl}/sso/discover`,
      { email },
      { context: new HttpContext().set(IS_PUBLIC_API, true) },
    );
  }

  createCheckoutSession(planId: string): Observable<{ url: string }> {
    // H-02 FIX: Send only planId. successUrl/cancelUrl are now built server-side
    // from FRONTEND_URL so the backend controls redirect destinations (CWE-601).
    return this.http.post<{ url: string }>(`${this.apiUrl}/create-checkout-session`, { planId }, { withCredentials: true });
  }

  /**
   * Payment-first signup: validates the registration and returns a Stripe
   * Checkout URL. No account is created until the payment completes — so an
   * abandoned checkout leaves no orphan account behind.
   */
  registerCheckout(payload: RegisterPayload & { planId: string }): Observable<{ url: string | null }> {
    return this.http.post<{ url: string | null }>(`${this.apiUrl}/register-checkout`, payload, {
      withCredentials: true,
      context: new HttpContext().set(IS_PUBLIC_API, true),
    });
  }

  /**
   * Finalizes signup after returning from Stripe Checkout. The backend creates
   * the account and sets auth cookies (auto-login); we hydrate the session.
   */
  confirmRegistration(sessionId: string): Observable<User> {
    return this.http
      .post<{ user: User }>(`${this.apiUrl}/register-confirm`, { sessionId }, {
        withCredentials: true,
        context: new HttpContext().set(IS_PUBLIC_API, true),
      })
      .pipe(
        map((response) => response.user),
        tap((user) => this.applyAuthenticated(user)),
      );
  }

  // Re-authentication travels as the httpOnly step-up cookie, not as a password in the body.
  enable2fa(token: string): Observable<unknown> {
      return this.http.post(`${this.apiUrl}/2fa/enable`, { token });
  }

  disable2fa(): Observable<any> {
      return this.http.post(`${this.apiUrl}/2fa/disable`, {});
  }

  // ------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------

  /**
   * Resolve who is signed in. Safe to call from anywhere, any number of times.
   *
   * The first call performs the bootstrap; every later one replays its result, synchronously,
   * without a request. That is what makes the guards cheap enough to leave on every route: they
   * can each ask, and the question is only ever answered once per application load.
   */
  resolveSession(): Observable<boolean> {
    return (this.sessionResolution ??= this.readSession().pipe(
      // refCount:false — the result must survive the app initializer unsubscribing, otherwise the
      // first guard to run would re-trigger the whole bootstrap.
      shareReplay({ bufferSize: 1, refCount: false }),
    ));
  }

  /**
   * Discard the memoised result and read the session again.
   *
   * For the cases where the PRINCIPAL itself changed underneath us and the client must see it now
   * — enabling or disabling a second factor, editing the profile, switching organization. Routing
   * must never call this: that is what `resolveSession()` is for.
   */
  reloadSession(): Observable<boolean> {
    this.sessionResolution = null;
    return this.resolveSession();
  }

  /**
   * The bootstrap itself: one request, and a second one only when the server has said it can
   * succeed.
   *
   * `GET /auth/session` always answers 200 — "signed out" is an answer, not an error — and says
   * whether a silent refresh is possible. So the three outcomes are all quiet:
   *
   *   authenticated              → one request, done.
   *   expired access token       → session + refresh, both 200.
   *   never signed in / signed out → one request, and NO refresh attempt.
   *
   * That last line is the whole point. The previous implementation could not tell those two apart
   * — it asked a protected endpoint, read the 401 as "maybe just expired", and fired a refresh to
   * find out — so a visitor sitting on the login screen produced a 401 followed by a 400, 401 or
   * 403, three times over.
   */
  private readSession(): Observable<boolean> {
    return this.http
      .get<SessionSnapshot>(`${this.apiUrl}/session`, {
        withCredentials: true,
        context: new HttpContext().set(IS_PUBLIC_API, true),
      })
      .pipe(
        switchMap((snapshot) => {
          if (snapshot.authenticated && snapshot.user) {
            return of(this.applyAuthenticated(snapshot.user));
          }

          if (snapshot.refreshable) {
            // `refreshAccessToken()` adopts the principal itself on success, so this only has to
            // report the outcome — applying it twice would re-open the socket for no reason.
            return this.refreshAccessToken().pipe(
              map((response) => (response?.user ? true : this.applySignedOut())),
              // The refresh token was revoked, replayed or expired between being issued and being
              // used. The server has already cleared the cookies; we only have to agree.
              catchError(() => of(this.applySignedOut())),
            );
          }

          return of(this.applySignedOut());
        }),
        catchError((error: HttpErrorResponse) => {
          // The API is unreachable or failing. We do not KNOW that the user is signed out — we
          // only know we could not find out. Unlike every other outcome above, that IS an
          // anomaly, so it gets one line in the console; and unlike them it is not an answer
          // worth keeping, so the memo is dropped and the next navigation asks again rather than
          // pinning the app to the login screen for the rest of the session over one bad
          // response. The order matters: `applySignedOut` pins the memo, so it is cleared after.
          console.warn(`No se pudo resolver la sesión (HTTP ${error.status}).`);
          const signedOut = this.applySignedOut();
          this.sessionResolution = null;
          return of(signedOut);
        }),
      );
  }

  /**
   * Adopt a signed-in principal. Every entry point into an authenticated state goes through here
   * — bootstrap, refresh, login, 2FA, signup — so none of them can forget a step.
   */
  private applyAuthenticated(user: User): boolean {
    this._currentUser.set(user);
    this._authStatus.set(AuthStatus.authenticated);
    this.sessionResolution = of(true);

    // The account's stored language wins over whatever this device guessed.
    //
    // Nothing used to read `preferredLanguage` when a session was restored, so a user whose
    // profile said English, opening the application in a private window, resolved to Spanish —
    // and the language service's sync effect then OVERWROTE the profile with that guess. The
    // server's answer was destroyed by the client's assumption on every visit from a new device.
    // The tenant's locale context travels with it: country, currency and timezone are what make
    // an amount and a posting date render correctly, and the browser cannot infer any of them.
    this.languageService.applySessionPreference(
      user.id,
      user.preferredLanguage,
      user.localeContext,
    );

    this.webSocketService.connect();
    this.webSocketService.emit('user-status', { isOnline: true });
    this.listenForForcedLogout();
    return true;
  }

  /** The mirror image: the single way the client enters a signed-out state. */
  private applySignedOut(): boolean {
    this._currentUser.set(null);
    this._authStatus.set(AuthStatus.unauthenticated);
    this.sessionResolution = of(false);

    // The device keeps the language it is reading in; the profile is no longer ours to write.
    this.languageService.detachSession();

    this.webSocketService.disconnect();
    return false;
  }

  // H12 FIX: Token is now read from the httpOnly social_register_token cookie by the backend;
  // do not pass it as a query param (URLs leak to browser history, server logs, Referer).
  getSocialRegisterInfo(): Observable<any> {
      return this.http.get(`${this.apiUrl}/social-register-info`, {
          withCredentials: true,
          context: new HttpContext().set(IS_PUBLIC_API, true)
      });
  }

  // 🔥 Añadir método para obtener permisos como observable
  getPermissions$(): Observable<string[]> {
    return this.user$.pipe(map((user) => user?.permissions || []));
  }

  /**
   * Registra un nuevo usuario en el sistema.
   * @param payload Objeto con los datos del nuevo usuario.
   * @returns Un observable que emite el objeto User del usuario recién creado.
   */

  /**
   * Cierra la sesión del usuario tanto en el frontend como en el backend.
   * @param notifyBackend Si es true, envía una petición de logout al backend. Si es false, solo limpia el estado local.
   */
  logout(notifyBackend = true): void {
    // 1. Limpiar estado local inmediatamente para asegurar respuesta rápida de UI.
    // `applySignedOut` also pins the memoised session resolution to "signed out", so the guards
    // that run during the redirect below settle without a request — and, because the server
    // clears the session marker cookie, a later hard reload is told `refreshable: false` and does
    // not probe either.
    this.webSocketService.emit('user-status', { isOnline: false });
    this.applySignedOut();
    // The sign-in page the user lands on must be in the language they were just using. The
    // language lives in one place — `LanguageService` — rather than being re-derived here from a
    // storage key this file also had to know the name of.
    this.router.navigate([`/${this.languageService.currentLanguage()}/auth/login`]);

    // H5 FIX: The backend /logout endpoint is protected by CsrfGuard, which requires the
    // X-XSRF-TOKEN header to match the signed XSRF-TOKEN cookie. navigator.sendBeacon cannot set
    // custom headers, so the previous beacon-based logout was rejected with 403 — and because
    // sendBeacon returns true once the request is merely *queued* (not delivered), the fetch
    // fallback never ran. The session (and its refresh token) could stay alive server-side while
    // the UI showed the user as logged out.
    //
    // We now use fetch() with `keepalive: true`, which both survives tab close/navigation (like a
    // beacon) AND lets us attach the CSRF header, so the server actually revokes the session.
    // (OWASP Session Management logout; OWASP CSRF Prevention; CWE-613/CWE-352.)
    if (notifyBackend) {
      this.revokeServerSession();
    }
  }

  /**
   * Best-effort server-side session revocation that satisfies the CSRF guard.
   * Uses keepalive fetch (survives unload) when available, otherwise falls back to HttpClient.
   */
  private revokeServerSession(): void {
    const url = `${this.apiUrl}/logout`;
    // Read through the same helper the interceptor uses. This used to go through Angular's
    // `HttpXsrfTokenExtractor`, which only knows the unprefixed `XSRF-TOKEN` name — so in every
    // deployment, where the cookie is `__Host-XSRF-TOKEN`, it found nothing and the keepalive
    // path silently never ran.
    const xsrfToken = readCsrfCookie();

    const canKeepaliveFetch =
      typeof fetch === 'function' &&
      // keepalive must be supported AND we must have a CSRF token to satisfy CsrfGuard.
      !!xsrfToken;

    if (canKeepaliveFetch) {
      fetch(url, {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-XSRF-TOKEN': xsrfToken as string,
        },
        body: '{}',
      }).catch(() => {
        // Network/unload failure — fall back to a tracked HttpClient request below.
        this.logoutViaHttpClient(url);
      });
      return;
    }

    this.logoutViaHttpClient(url);
  }

  private logoutViaHttpClient(url: string): void {
    // HttpClient routes through the auth interceptor, which attaches X-XSRF-TOKEN automatically.
    this.http.post(url, {}, {
      withCredentials: true,
      context: new HttpContext().set(IS_PUBLIC_API, true),
    }).pipe(
      catchError((err: HttpErrorResponse) => {
        // A 401/403 here means the session/token is already invalid server-side — i.e. there is
        // nothing left to revoke, so the logout effectively succeeded. Only a real failure
        // (network error, 5xx) warrants warning the user.
        if (err.status !== 401 && err.status !== 403) {
          this.notificationService.showWarning(
            'No se pudo cerrar la sesión en el servidor. Cierra el navegador o intenta de nuevo.'
          );
        }
        return of(null);
      })
    ).subscribe();
  }

  // ------------------------------------------------------------------
  // WebAuthn (Passkeys)
  // ------------------------------------------------------------------

  async registerPasskey(): Promise<void> {
    try {
      // 1. Get options from backend
      const options = await firstValueFrom(this.http.get<any>(`${this.apiUrl}/webauthn/register/options`));

      // 2. Pass options to browser
      const credential = await startRegistration({ optionsJSON: options });

      // 3. Send credential to backend
      await firstValueFrom(this.http.post(`${this.apiUrl}/webauthn/register/verify`, credential));

      this.notificationService.showSuccess('Llave de acceso registrada correctamente');
    } catch (error) {
      // Passkey registration failed
      this.notificationService.showError('Error al registrar la llave de acceso');
      throw error;
    }
  }

  async loginWithPasskey(email?: string): Promise<User | null> {
    try {
      // 1. Get options from backend
      const options = await firstValueFrom(this.http.post<any>(`${this.apiUrl}/webauthn/login/options`, { email }, {
          context: new HttpContext().set(IS_PUBLIC_API, true)
      }));

      // 2. Pass options to browser
      const credential = await startAuthentication({ optionsJSON: options });

      // 3. Send credential to backend for verification and login
      // Add challengeId which was returned in options
      const body = {
        credential,
        challengeId: options.challengeId
      };

      const response = await firstValueFrom(this.http.post<LoginResponse>(`${this.apiUrl}/webauthn/login/verify`, body, {
          withCredentials: true,
          context: new HttpContext().set(IS_PUBLIC_API, true)
      }));

      if (response.user) {
        this.applyAuthenticated(response.user);
      }
      return response.user;
    } catch (error) {
      // Passkey login failed
      this.notificationService.showError('Error al iniciar sesión con llave de acceso');
      throw error;
    }
  }

  /**
   * Inicia el flujo de recuperación de contraseña.
   * @param email El correo electrónico del usuario.
   * @returns Un observable que emite un mensaje de confirmación del backend.
   */
  forgotPassword(
    email: string,
    recaptchaToken: string
  ): Observable<{ message: string }> {
    const url = `${this.apiUrl}/forgot-password`;
    return this.http
      .post<{ message: string }>(url, { email, recaptchaToken }, {
        context: new HttpContext().set(IS_PUBLIC_API, true)
      })
      .pipe(catchError((err) => this.errorHandlerService.handleError('forgotPassword', err)));
  }

  /**
   * Envía la nueva contraseña y el token de reseteo al backend.
   * @param token El token recibido por el usuario (generalmente en la URL).
   * @param password La nueva contraseña.
   * @returns Un observable que emite el objeto User con la información actualizada.
   */
  resetPassword(token: string, password: string): Observable<User> {
    const url = `${this.apiUrl}/reset-password`;
    return this.http
      .post<User>(url, { token, password }, {
        context: new HttpContext().set(IS_PUBLIC_API, true)
      })
      .pipe(catchError((err) => this.errorHandlerService.handleError('resetPassword', err)));
  }

  // **** ✅ NUEVO MÉTODO AÑADIDO ****
  setPasswordFromInvitation(
    token: string,
    password: string
  ): Observable<{ user: User }> {
    const url = `${this.apiUrl}/set-password-from-invitation`;
    return this.http
      .post<{ user: User }>(url, { token, password }, {
        withCredentials: true,
        context: new HttpContext().set(IS_PUBLIC_API, true)
      })
      .pipe(
        tap((response) => {
          // Setting the password also signs the user in, so it goes through the one funnel:
          // setting the two signals by hand skipped the socket connection, the forced-logout
          // listener and the language the account is configured in.
          this.applyAuthenticated(response.user);
        }),
        catchError((err) => this.errorHandlerService.handleError('setPasswordFromInvitation', err))
      );
  }

  // H4/H-02 FIX: Token submitted in POST body — never in URL path/query to prevent
  // leakage in server logs, browser history, and Referer headers (CWE-598; OWASP ASVS 2.1.7).
  getInvitationDetails(token: string): Observable<{ firstName: string }> {
    const url = `${this.apiUrl}/invitation/details`;
    return this.http
      .post<{ firstName: string }>(url, { token }, {
        context: new HttpContext().set(IS_PUBLIC_API, true)
      })
      .pipe(catchError((err) => this.errorHandlerService.handleError('getInvitationDetails', err)));
  }

  // --- NUEVOS MÉTODOS ---

  /**
   * Invita a un nuevo usuario al sistema.
   */
  inviteUser(payload: UserPayload): Observable<User> {
    // Nota: El backend creará este usuario con estado 'PENDING'.
    return this.http.post<User>(`${this.usersUrl}/invite`, payload);
  }

  // H6 FIX: User management operations belong to /users not /auth.
  private get usersUrl(): string {
    return `${this.baseUrl}/users`;
  }

  updateUser(id: string, payload: UserPayload): Observable<User> {
    return this.http.patch<User>(`${this.usersUrl}/${id}`, payload);
  }

  updateUserStatus(id: string, status: UserStatus): Observable<User> {
    return this.http.patch<User>(`${this.usersUrl}/${id}/status`, { status });
  }

  deleteUser(id: string): Observable<void> {
    return this.http.delete<void>(`${this.usersUrl}/${id}`);
  }

  // --- NUEVOS MÉTODOS PARA SUPLANTACIÓN ---
  impersonate(userId: string): Observable<User> {
    return this.http
      .post<{ user: User }>(
        `${this.apiUrl}/impersonate`,
        { userId },
        { withCredentials: true }
      )
      .pipe(
        tap((response) => {
          // Through the funnel: impersonation swaps the principal, so the socket must reconnect
          // as the new one and the interface must follow THAT account's language.
          this.applyAuthenticated(response.user);
          this.notificationService.showSuccess(
            this.translate.instant('AUTH.IMPERSONATION.STARTED', { name: response.user.firstName }),
          );
          // Usar Router en lugar de recarga forzada
          this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
            this.router.navigate(['/overview']);
          });
        }),
        map((response) => response.user),
        catchError((err) => this.errorHandlerService.handleError('impersonate', err))
      );
  }

  stopImpersonation(): Observable<User> {
    return this.http
      .post<{ user: User }>(
        `${this.apiUrl}/stop-impersonation`,
        {},
        { withCredentials: true }
      )
      .pipe(
        tap((response) => {
          this.applyAuthenticated(response.user);
          this.notificationService.showSuccess(
            this.translate.instant('AUTH.IMPERSONATION.STOPPED'),
          );
          // Usar Router en lugar de recarga forzada
          this.router.navigateByUrl('/', { skipLocationChange: true }).then(() => {
            this.router.navigate(['/overview']);
          });
        }),
        map((response) => response.user),
        catchError((err) => this.errorHandlerService.handleError('stopImpersonation', err))
      );
  }

  // H8 FIX: changePassword is an authenticated endpoint; removing IS_PUBLIC_API allows the
  // interceptor to attach cookies/XSRF and trigger a token refresh on 401 if needed.
  // The step-up proof travels as an httpOnly cookie set by /auth/verify-password, so there is
  // no token for the caller to carry and none for an XSS to steal.
  changePassword(data: { currentPassword: string; newPassword: string }): Observable<{ message: string }> {
      const body = data;
      return this.http.post<{ message: string }>(`${this.apiUrl}/change-password`, body).pipe(
          catchError((err) => this.errorHandlerService.handleError('changePassword', err))
      );
  }
}
