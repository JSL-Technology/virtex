import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { NavigationEnd } from '@angular/router';

import {
  ActiveOrganizationService,
  pathWithoutOrganization,
  slugFromUrl,
} from './active-organization.service';
import { AuthService } from '../services/auth';

/**
 * La empresa es parte de la URL, y de esta clase depende que eso no se convierta en un enlace mal
 * construido. Un enlace sin empresa —o con la empresa equivocada— manda a alguien a los libros de
 * otro inquilino, y el servidor lo rechazaría, pero la navegación ya habría mentido.
 */
describe('ActiveOrganizationService', () => {
  const ORG_A = { id: 'org-a', legalName: 'Cliente A', slug: 'cliente-a' };
  const ORG_B = { id: 'org-b', legalName: 'Cliente B', slug: 'cliente-b' };

  let events: Subject<NavigationEnd>;
  let url: string;

  const build = (user: unknown = { organization: ORG_A, organizations: [ORG_A, ORG_B] }) => {
    events = new Subject<NavigationEnd>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        ActiveOrganizationService,
        { provide: Router, useValue: { events, get url() { return url; } } },
        { provide: AuthService, useValue: { currentUser: () => user } },
      ],
    });
    return TestBed.inject(ActiveOrganizationService);
  };

  const navigate = (to: string) => {
    url = to;
    events.next(new NavigationEnd(1, to, to));
  };

  beforeEach(() => {
    url = '/e/cliente-a/overview';
    localStorage.clear();
  });

  describe('slugFromUrl', () => {
    it.each([
      ['/e/cliente-a/overview', 'cliente-a'],
      ['/e/cliente-a', 'cliente-a'],
      ['/e/cliente-a/invoices?status=overdue', 'cliente-a'],
      ['/e/cliente-a/settings#settings/profile', 'cliente-a'],
      ['/overview', null],
      ['/', null],
      ['/es/auth/login', null],
      ['/e', null],
    ])('%s → %s', (input, expected) => {
      expect(slugFromUrl(input)).toBe(expected);
    });
  });

  describe('pathWithoutOrganization', () => {
    it.each([
      ['/e/cliente-a/accounting/journal-entries', '/accounting/journal-entries'],
      ['/e/cliente-a', '/'],
      ['/e/cliente-a/invoices?status=overdue', '/invoices?status=overdue'],
      ['/overview', '/overview'],
    ])('%s → %s', (input, expected) => {
      expect(pathWithoutOrganization(input)).toBe(expected);
    });

    it('descarta el fragmento, que es de la ventana y no de la ruta', () => {
      expect(pathWithoutOrganization('/e/cliente-a/invoices#settings/profile')).toBe('/invoices');
    });
  });

  it('lee la empresa de la URL', () => {
    const service = build();
    navigate('/e/cliente-b/invoices');

    expect(service.slug()).toBe('cliente-b');
    expect(service.organization()?.id).toBe('org-b');
  });

  it('sin empresa en la URL se cae a la del principal, para no dejar la barra vacía al arrancar', () => {
    url = '/overview';
    const service = build();

    expect(service.slug()).toBeNull();
    expect(service.organization()?.id).toBe('org-a');
  });

  it('una empresa que no es del usuario no se reconoce como accesible', () => {
    const service = build();
    navigate('/e/empresa-ajena/invoices');

    expect(service.isSlugAccessible()).toBe(false);
  });

  it('urlFor pone el prefijo una sola vez', () => {
    const service = build();
    navigate('/e/cliente-a/overview');

    expect(service.urlFor('/invoices')).toBe('/e/cliente-a/invoices');
    expect(service.urlFor('invoices')).toBe('/e/cliente-a/invoices');
    // Idempotente: una redirección puede traer la ruta ya prefijada.
    expect(service.urlFor('/e/cliente-a/invoices')).toBe('/e/cliente-a/invoices');
  });

  it('urlFor sin empresa devuelve la ruta tal cual, en vez de inventarse un prefijo', () => {
    url = '/overview';
    const service = build({ organization: null, organizations: [] });

    expect(service.urlFor('/invoices')).toBe('/invoices');
  });

  it('urlInOrganization conserva la página y cambia la empresa', () => {
    const service = build();
    navigate('/e/cliente-a/accounting/journal-entries');

    expect(service.urlInOrganization('cliente-b')).toBe('/e/cliente-b/accounting/journal-entries');
  });

  it('recuerda la última empresa solo si sigue siendo accesible', () => {
    const service = build();
    service.remember('cliente-b');
    expect(service.lastUsed()).toBe('cliente-b');

    // Le retiran el acceso: la memoria deja de valer, en vez de mandarlo a un 403.
    const sinAcceso = build({ organization: ORG_A, organizations: [ORG_A] });
    expect(sinAcceso.lastUsed()).toBeNull();
  });
});
