import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { environment } from '../../environments/environment';
import { sessionExpiryInterceptor } from './session-expiry.interceptor';

const API = environment.apiUrl;

describe('sessionExpiryInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionExpiryInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: LocaleStore,
          useValue: { setTenantContext: jest.fn(), setLanguage: jest.fn() },
        },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => backend.verify());

  it('renews once on a 401 and replays the request', () => {
    let body: unknown;
    http.get(`${API}/pos/catalog`).subscribe((value) => (body = value));
    backend
      .expectOne(`${API}/pos/catalog`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    backend.expectOne(`${API}/auth/refresh`).flush({});
    backend.expectOne(`${API}/pos/catalog`).flush([{ id: 'p1' }]);
    expect(body).toEqual([{ id: 'p1' }]);
  });

  it('sends the till to the sign-in screen, saying why, when the session cannot be renewed', () => {
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    let failed = false;
    http.get(`${API}/pos/catalog`).subscribe({ error: () => (failed = true) });
    backend
      .expectOne(`${API}/pos/catalog`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    backend
      .expectOne(`${API}/auth/refresh`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(failed).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: 'expired' },
    });
  });

  it('never tries to renew on the session routes themselves', () => {
    let status = 0;
    http
      .post(`${API}/auth/login`, {})
      .subscribe({ error: (e) => (status = e.status) });
    backend
      .expectOne(`${API}/auth/login`)
      .flush(null, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
  });
});
