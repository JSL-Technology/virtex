import { TestBed } from '@angular/core/testing';
import { HttpRequest, HttpHandlerFn, HttpEvent } from '@angular/common/http';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import {
  activeOrganizationInterceptor,
  ACTIVE_ORGANIZATION_HEADER,
} from './active-organization.interceptor';
import { ActiveOrganizationService } from './active-organization.service';

/**
 * La cabecera es cómo el servidor sabe en qué empresa actúa esta ventana. Si se pierde, la
 * petición se resuelve con la empresa del token —la de otra pestaña—, que es el error que todo
 * este diseño existe para evitar.
 */
describe('activeOrganizationInterceptor', () => {
  const slug = signal<string | null>('cliente-a');
  let next: jest.Mock<ReturnType<HttpHandlerFn>, [HttpRequest<unknown>]>;

  const send = (url: string) => {
    next = jest.fn((r: HttpRequest<unknown>) => of({ request: r } as unknown as HttpEvent<unknown>));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: ActiveOrganizationService, useValue: { slug } }],
    });
    return TestBed.runInInjectionContext(() =>
      activeOrganizationInterceptor(new HttpRequest('GET', url), next as unknown as HttpHandlerFn),
    );
  };

  beforeEach(() => slug.set('cliente-a'));

  it('sella las llamadas a la propia API', () => {
    send('/api/v1/invoices').subscribe();
    expect(next.mock.calls[0][0].headers.get(ACTIVE_ORGANIZATION_HEADER)).toBe('cliente-a');
  });

  it('no sella una llamada a un tercero: no tiene por qué saber en qué empresa trabajamos', () => {
    send('https://api.stripe.com/v1/tokens').subscribe();
    expect(next.mock.calls[0][0].headers.has(ACTIVE_ORGANIZATION_HEADER)).toBe(false);
  });

  it('sin empresa —login, alta, retorno de pago— la petición sale igual que antes', () => {
    slug.set(null);
    send('/api/v1/auth/login').subscribe();
    expect(next.mock.calls[0][0].headers.has(ACTIVE_ORGANIZATION_HEADER)).toBe(false);
  });

  it('no muta la petición original', () => {
    const result = send('/api/v1/invoices');
    result.subscribe();
    expect(next.mock.calls[0][0]).not.toBe(undefined);
    expect(next.mock.calls[0][0].headers.get(ACTIVE_ORGANIZATION_HEADER)).toBe('cliente-a');
  });
});
