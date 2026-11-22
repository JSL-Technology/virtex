import { TestBed } from '@angular/core/testing';
import { HttpEvent, HttpHandlerFn, HttpHeaders, HttpRequest, HttpResponse } from '@angular/common/http';
import { of } from 'rxjs';
import { NOTICES_HEADER, serializeRequestNotices } from '@virtex/shared/types';
import { noticesInterceptor } from './notices.interceptor';
import { NotificationService } from '../services/notification';

/**
 * Lo que el servidor avisa de una petición que salió bien con una salvedad (FINB-06) llega a la
 * pantalla, sea cual sea la pantalla que la hizo.
 */
describe('noticesInterceptor', () => {
  const showWarning = jest.fn();

  const respond = (headers: HttpHeaders) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: NotificationService, useValue: { showWarning } }] });
    const next: HttpHandlerFn = () => of(new HttpResponse({ status: 201, headers, body: { id: 'x' } }) as HttpEvent<unknown>);
    return TestBed.runInInjectionContext(() => noticesInterceptor(new HttpRequest('POST', '/api/v1/journal-entries', {}), next));
  };

  beforeEach(() => showWarning.mockReset());

  it('muestra cada aviso con su clave y sus parámetros, en el idioma del catálogo', () => {
    const header = serializeRequestNotices([
      {
        code: 'EXCHANGE_RATE_MARKET_FALLBACK',
        messageKey: 'currencies.market_rate_used_without_official',
        messageParams: { from: 'USD', to: 'DOP', date: '2026-03-15', source: 'XE', quotedOn: '2026-03-15' },
        message: 'No había tasa oficial…',
      },
    ]);
    respond(new HttpHeaders({ [NOTICES_HEADER]: header })).subscribe();
    expect(showWarning).toHaveBeenCalledWith('currencies.market_rate_used_without_official', {
      from: 'USD',
      to: 'DOP',
      date: '2026-03-15',
      source: 'XE',
      quotedOn: '2026-03-15',
    });
  });

  it('sin cabecera no muestra nada', () => {
    respond(new HttpHeaders()).subscribe();
    expect(showWarning).not.toHaveBeenCalled();
  });

  it('una cabecera que no es la del servidor se ignora en lugar de romper la respuesta', () => {
    const received: unknown[] = [];
    respond(new HttpHeaders({ [NOTICES_HEADER]: '%E0%A4%A' })).subscribe((event) => received.push(event));
    respond(new HttpHeaders({ [NOTICES_HEADER]: encodeURIComponent('{"code":"X"}') })).subscribe((event) => received.push(event));
    expect(showWarning).not.toHaveBeenCalled();
    expect(received).toHaveLength(2);
  });
});
