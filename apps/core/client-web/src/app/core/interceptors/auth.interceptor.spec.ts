import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom, throwError } from 'rxjs';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth';
import { AuthQueueService } from '../services/auth-queue.service';
import { HttpXsrfTokenExtractor } from '@angular/common/http';

/**
 * A lapsed subscription now produces a 403 on every authenticated route at once, because
 * entitlement is enforced globally rather than on the single controller that used to declare the
 * guard. Unhandled, that is a wall of failed requests and no explanation; the customer has to land
 * where they can fix it.
 */
describe('authInterceptor — subscription handling', () => {
  const navigate = jest.fn();

  const run = (error: HttpErrorResponse, currentUrl = '/dashboard') => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { url: currentUrl, navigate } },
        { provide: AuthService, useValue: { refreshAccessToken: jest.fn() } },
        { provide: AuthQueueService, useValue: { isRefreshingToken: false } },
        { provide: HttpXsrfTokenExtractor, useValue: { getToken: () => null } },
      ],
    });

    const req = new HttpRequest('GET', '/api/v1/invoices');
    const next: HttpHandlerFn = () => throwError(() => error);

    return TestBed.runInInjectionContext(() =>
      firstValueFrom(authInterceptor(req, next)).catch((e) => e),
    );
  };

  beforeEach(() => navigate.mockClear());

  it('sends a suspended tenant to billing', async () => {
    await run(
      new HttpErrorResponse({ status: 403, error: { message: 'SUBSCRIPTION_SUSPENDED: unpaid' } }),
    );

    expect(navigate).toHaveBeenCalledWith(['/settings/billing'], {
      queryParams: { reason: 'SUBSCRIPTION_SUSPENDED' },
    });
  });

  it('sends a tenant with no subscription there too', async () => {
    await run(new HttpErrorResponse({ status: 403, error: { message: 'SUBSCRIPTION_REQUIRED' } }));

    expect(navigate).toHaveBeenCalledWith(['/settings/billing'], {
      queryParams: { reason: 'SUBSCRIPTION_REQUIRED' },
    });
  });

  it('does not navigate when already on the billing page', async () => {
    // A dashboard fires a dozen calls in parallel and they all fail together; navigating per
    // failed request would fight the router.
    await run(
      new HttpErrorResponse({ status: 403, error: { message: 'SUBSCRIPTION_SUSPENDED: unpaid' } }),
      '/settings/billing',
    );

    expect(navigate).not.toHaveBeenCalled();
  });

  describe('una sesión retenida hasta activar el segundo factor', () => {
    /**
     * Cuando la empresa exige MFA y la persona no lo tiene, `MfaEnrolmentGuard` rechaza toda ruta
     * que no sea la de alta. Sin tratarlo, eso es un panel lleno de errores y ninguna explicación
     * — y la única acción que lo resuelve es justo la que nadie le ha dicho que haga.
     */
    it('lleva a la pantalla donde se activa', async () => {
      await run(
        new HttpErrorResponse({
          status: 403,
          error: { messageKey: 'auth.mfa_required_by_organization' },
        }),
      );

      expect(navigate).toHaveBeenCalledWith(['/settings/security'], {
        queryParams: { reason: 'MFA_REQUIRED' },
      });
    });

    it('no navega si ya está allí', async () => {
      await run(
        new HttpErrorResponse({
          status: 403,
          error: { messageKey: 'auth.mfa_required_by_organization' },
        }),
        '/settings/security',
      );

      expect(navigate).not.toHaveBeenCalled();
    });

    /**
     * La sesión existe: la retención viaja DENTRO del token, así que renovarlo saldría bien y no
     * cambiaría nada. Por eso es 403 y no 401, y por eso no debe disparar el refresco.
     */
    it('no intenta refrescar la sesión', async () => {
      const error = new HttpErrorResponse({
        status: 403,
        error: { messageKey: 'auth.mfa_required_by_organization' },
      });

      await expect(run(error)).resolves.toBe(error);
    });
  });

  it('leaves an ordinary permission denial alone', async () => {
    await run(new HttpErrorResponse({ status: 403, error: { message: 'Forbidden resource' } }));

    expect(navigate).not.toHaveBeenCalled();
  });

  it('re-throws so the caller still sees the failure', async () => {
    const error = new HttpErrorResponse({
      status: 403,
      error: { message: 'SUBSCRIPTION_SUSPENDED: unpaid' },
    });

    await expect(run(error)).resolves.toBe(error);
  });
});
