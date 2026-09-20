import { TestBed } from '@angular/core/testing';
import { Router, RouterStateSnapshot, UrlTree } from '@angular/router';

import { organizationRouteGuard } from './organization-route.guard';
import { ActiveOrganizationService } from './active-organization.service';
import { AuthService } from '../services/auth';

/**
 * El guard no autoriza —eso lo hace el servidor en cada petición— pero decide dónde aterriza la
 * gente, y ahí es donde se nota si un enlace viejo sigue funcionando.
 */
describe('organizationRouteGuard', () => {
  const ORG_A = { id: 'org-a', legalName: 'Cliente A', slug: 'cliente-a' };
  const ORG_B = { id: 'org-b', legalName: 'Cliente B', slug: 'cliente-b' };

  let parseUrl: jest.Mock;
  let remember: jest.Mock;
  let lastUsed: jest.Mock;

  const run = (url: string, user: unknown) => {
    parseUrl = jest.fn((u: string) => ({ toString: () => u }) as unknown as UrlTree);
    remember = jest.fn();
    lastUsed = jest.fn().mockReturnValue(null);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { parseUrl } },
        { provide: AuthService, useValue: { currentUser: () => user } },
        {
          provide: ActiveOrganizationService,
          useValue: {
            urlFor: (path: string, slug: string | null) => `/e/${slug}${path === '/' ? '' : path}`,
            remember,
            lastUsed,
          },
        },
      ],
    });

    const state = { url } as RouterStateSnapshot;
    return TestBed.runInInjectionContext(() =>
      organizationRouteGuard({} as never, state),
    );
  };

  const user = { organization: ORG_A, organizations: [ORG_A, ORG_B] };

  it('deja pasar una empresa a la que el usuario pertenece', () => {
    expect(run('/e/cliente-b/invoices', user)).toBe(true);
  });

  it('anota la empresa por la que se entra', () => {
    run('/e/cliente-b/invoices', user);
    expect(remember).toHaveBeenCalledWith('cliente-b');
  });

  it('una URL SIN empresa se reenvía a la misma página dentro de la del usuario', () => {
    const result = run('/accounting/journal-entries', user);
    expect(String(result)).toBe('/e/cliente-a/accounting/journal-entries');
  });

  it('una empresa ajena se reenvía a la propia, sin decir si existe', () => {
    const result = run('/e/empresa-ajena/invoices', user);
    expect(String(result)).toBe('/e/cliente-a/invoices');
  });

  it('prefiere la última empresa usada al respaldar', () => {
    parseUrl = jest.fn((u: string) => ({ toString: () => u }) as unknown as UrlTree);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { parseUrl } },
        { provide: AuthService, useValue: { currentUser: () => user } },
        {
          provide: ActiveOrganizationService,
          useValue: {
            urlFor: (path: string, slug: string | null) => `/e/${slug}${path === '/' ? '' : path}`,
            remember: jest.fn(),
            lastUsed: () => 'cliente-b',
          },
        },
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      organizationRouteGuard({} as never, { url: '/invoices' } as RouterStateSnapshot),
    );
    expect(String(result)).toBe('/e/cliente-b/invoices');
  });

  it('un usuario sin ninguna empresa va a la pantalla que lo explica', () => {
    const result = run('/invoices', { organization: null, organizations: [] });
    expect(String(result)).toBe('/unauthorized');
  });

  it('sin principal no decide nada: de eso se encarga authGuard, que corre antes', () => {
    expect(run('/invoices', null)).toBe(true);
  });
});
