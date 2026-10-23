import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpTestingController } from '@angular/common/http/testing';

import { FavoritesService, MAX_FAVORITES } from './favorites.service';
import { ActiveModuleService, Destination } from '../modules/active-module.service';
import { ModuleManifest } from '../modules/module-manifest';
import { AuthService } from '../services/auth';
import { NotificationService } from '../services/notification';

/**
 * Favourites change optimistically and are stored on the server. What these tests defend is that
 * the optimism never lies for long: writes reach the server in the order they were made, a failed
 * write says so and comes back to what is stored, and switching company never mixes two lists.
 */
describe('FavoritesService', () => {
  const URL = 'http://localhost:3000/api/v1/me/favorites';
  const contabilidad = { id: 'contabilidad', titleKey: 'modules.accounting' } as ModuleManifest;

  const destinations = new Map<string, Destination>(
    ['/accounting/journals', '/accounting/ledgers', '/invoices', '/customers'].map((route) => [
      route,
      { route, path: `/e/acme${route}`, labelKey: route, icon: null, module: contabilidad },
    ]),
  );

  let user: ReturnType<typeof signal<{ id: string; organizationId: string } | null>>;
  let http: HttpTestingController;
  let notify: { showWarning: jest.Mock; showInfo: jest.Mock; showHttpError: jest.Mock };

  function setup(cached?: string[]): FavoritesService {
    localStorage.clear();
    if (cached) localStorage.setItem('virtex.nav.favorites.u1:o1', JSON.stringify(cached));
    user = signal<{ id: string; organizationId: string } | null>({ id: 'u1', organizationId: 'o1' });
    notify = { showWarning: jest.fn(), showInfo: jest.fn(), showHttpError: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { currentUser: user.asReadonly() } },
        { provide: NotificationService, useValue: notify },
        { provide: ActiveModuleService, useValue: { destinations: signal(destinations).asReadonly() } },
      ],
    });
    const service = TestBed.inject(FavoritesService);
    TestBed.tick();
    http = TestBed.inject(HttpTestingController);
    return service;
  }

  const routes = (service: FavoritesService) => service.items().map((i) => i.route);
  const flush = () => new Promise((resolve) => setTimeout(resolve));

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('dibuja al instante la copia local, y adopta la del servidor cuando llega', async () => {
    const service = setup(['/invoices']);
    expect(routes(service)).toEqual(['/invoices']);

    http.expectOne(URL).flush({ routes: ['/customers', '/invoices'] });
    await flush();

    expect(routes(service)).toEqual(['/customers', '/invoices']);
    expect(JSON.parse(localStorage.getItem('virtex.nav.favorites.u1:o1')!)).toEqual(['/customers', '/invoices']);
  });

  it('añadir se ve antes de que el servidor conteste', async () => {
    const service = setup();
    http.expectOne(URL).flush({ routes: [] });
    await flush();

    service.add('/e/acme/accounting/journals');

    expect(routes(service)).toEqual(['/accounting/journals']);
    await flush();
    const request = http.expectOne((r) => r.method === 'POST' && r.url === URL);
    expect(request.request.body).toEqual({ route: '/accounting/journals' });
    request.flush({ routes: ['/accounting/journals'] });
  });

  it('las escrituras salen de una en una, en el orden en que se hicieron', async () => {
    const service = setup();
    http.expectOne(URL).flush({ routes: [] });
    await flush();

    service.add('/invoices');
    service.remove('/invoices', { undoable: false });

    await flush();
    // Solo la primera ha salido: la segunda espera a su respuesta.
    const add = http.expectOne((r) => r.method === 'POST');
    http.expectNone((r) => r.method === 'DELETE');
    add.flush({ routes: ['/invoices'] });
    // La respuesta intermedia no se adopta: hay otra escritura en cola y la pantalla ya la refleja.
    await flush();
    expect(routes(service)).toEqual([]);

    const remove = http.expectOne((r) => r.method === 'DELETE');
    expect(remove.request.params.get('route')).toBe('/invoices');
    remove.flush({ routes: [] });
    await flush();
    expect(routes(service)).toEqual([]);
  });

  it('una escritura que falla lo dice y vuelve a lo que hay guardado', async () => {
    const service = setup();
    http.expectOne(URL).flush({ routes: ['/customers'] });
    await flush();

    service.add('/invoices');
    expect(routes(service)).toEqual(['/customers', '/invoices']);
    await flush();
    http.expectOne((r) => r.method === 'POST').flush({}, { status: 500, statusText: 'Server Error' });
    await flush();

    expect(notify.showHttpError).toHaveBeenCalledWith(expect.anything(), 'shell.favorites.save_failed');
    http.expectOne((r) => r.method === 'GET').flush({ routes: ['/customers'] });
    await flush();
    expect(routes(service)).toEqual(['/customers']);
  });

  it(`no pasa de ${MAX_FAVORITES}, y lo explica en vez de fallar en silencio`, async () => {
    const many = Array.from({ length: MAX_FAVORITES }, (_, i) => `/r${i}`);
    const service = setup();
    http.expectOne(URL).flush({ routes: many });
    await flush();

    service.add('/invoices');

    expect(notify.showWarning).toHaveBeenCalledWith('shell.favorites.limit', { max: MAX_FAVORITES });
    http.expectNone((r) => r.method === 'POST');
  });

  it('solo ofrece destinos del menú que este puesto puede abrir', async () => {
    const service = setup();
    http.expectOne(URL).flush({ routes: ['/invoices', '/ya-no-existe'] });
    await flush();

    expect(service.canFavorite('/e/acme/invoices')).toBe(true);
    expect(service.canFavorite('/invoices/88')).toBe(false);
    // Lo que dejó de estar disponible se oculta, no se borra.
    expect(routes(service)).toEqual(['/invoices']);
    service.add('/no-es-del-menu');
    http.expectNone((r) => r.method === 'POST');
  });

  it('quitar ofrece deshacer, y deshacer lo devuelve a su sitio', async () => {
    const service = setup();
    http.expectOne(URL).flush({ routes: ['/invoices', '/customers', '/accounting/journals'] });
    await flush();

    service.remove('/customers');
    const undo = notify.showInfo.mock.calls[0][2].handler as () => void;
    expect(routes(service)).toEqual(['/invoices', '/accounting/journals']);

    undo();
    expect(routes(service)).toEqual(['/invoices', '/customers', '/accounting/journals']);

    await flush();
    http.expectOne((r) => r.method === 'DELETE').flush({ routes: ['/invoices', '/accounting/journals'] });
    await flush();
    http.expectOne((r) => r.method === 'POST').flush({ routes: ['/invoices', '/accounting/journals', '/customers'] });
    await flush();
    const order = http.expectOne((r) => r.method === 'PUT');
    expect(order.request.body).toEqual({ routes: ['/invoices', '/customers', '/accounting/journals'] });
    order.flush({ routes: ['/invoices', '/customers', '/accounting/journals'] });
  });

  it('mover cambia el orden y lo guarda', async () => {
    const service = setup();
    http.expectOne(URL).flush({ routes: ['/invoices', '/customers'] });
    await flush();

    service.move('/customers', -1);
    expect(routes(service)).toEqual(['/customers', '/invoices']);
    service.move('/customers', -1); // ya es el primero: no hace nada

    await flush();
    http.expectOne((r) => r.method === 'PUT').flush({ routes: ['/customers', '/invoices'] });
  });

  it('al cambiar de empresa no mezcla listas, ni adopta una respuesta tardía de la anterior', async () => {
    const service = setup();
    const late = http.expectOne(URL);

    user.set({ id: 'u1', organizationId: 'o2' });
    TestBed.tick();
    late.flush({ routes: ['/invoices'] }); // contesta tarde, para la empresa anterior
    await flush();
    expect(routes(service)).toEqual([]);

    http.expectOne(URL).flush({ routes: ['/customers'] });
    await flush();
    expect(routes(service)).toEqual(['/customers']);
  });

  it('sin sesión no hay favoritos ni peticiones', () => {
    const service = setup(['/invoices']);
    http.expectOne(URL).flush({ routes: ['/invoices'] });

    user.set(null);
    TestBed.tick();

    expect(routes(service)).toEqual([]);
  });
});
