import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { NavigationEnd, Router } from '@angular/router';
import { ActiveModuleService, normalizeRoute } from './active-module.service';
import { AuthService } from '../services/auth';
import { MODULES } from './module-registry';
import { ModuleManifest } from './module-manifest';

/**
 * The one place that decides what the navigation offers.
 *
 * Both shells read it — the vertical panel and the top bar's mega-menu — so a rule that lived in a
 * component would be a rule applied in one and a half places. What matters here: the module comes
 * from the URL and is never stored, entries the server would refuse are never offered, and exactly
 * one entry can be the active one.
 */
describe('ActiveModuleService', () => {
  const events = new Subject<unknown>();
  let permissions: string[] = [];

  function make(url: string, granted: string[]): ActiveModuleService {
    permissions = granted;
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: { url, events } },
        {
          provide: AuthService,
          useValue: {
            hasPermissions: (required: string[]) => required.every((p) => permissions.includes(p)),
          },
        },
      ],
    });
    return TestBed.inject(ActiveModuleService);
  }

  const todos = () =>
    MODULES.flatMap((m) => m.routes.map((r) => r.permission)).filter((p) => p !== 'authenticated');

  const ventas = MODULES.find((m) => m.id === 'ventas') as ModuleManifest;

  afterEach(() => TestBed.resetTestingModule());

  it('deriva el módulo de la URL', () => {
    const svc = make('/invoices', todos());

    expect(svc.active()?.id).toBe('ventas');
  });

  it('sigue a la navegación sin que nadie le diga en qué módulo está', () => {
    // A stored "current module" is a second copy of what the address already says, and the two
    // drift on the first deep link or back button. This is the test that keeps it derived.
    const svc = make('/invoices', todos());
    expect(svc.active()?.id).toBe('ventas');

    events.next(new NavigationEnd(1, '/accounts-payable', '/accounts-payable'));

    expect(svc.active()?.id).toBe('compras');
  });

  it('Ventas › Antigüedad de saldos no salta a otro módulo (QA C-05)', () => {
    const svc = make('/invoices', todos());

    events.next(new NavigationEnd(1, '/reports/aging/receivables', '/reports/aging/receivables'));
    expect(svc.active()?.id).toBe('ventas');

    // Abierta en frío (un marcador) también es de Ventas.
    TestBed.resetTestingModule();
    expect(make('/reports/aging/receivables', todos()).active()?.id).toBe('ventas');
  });

  it('se queda en el módulo actual cuando su menú también ofrece la página', () => {
    const svc = make('/accounts-payable', todos());
    const comprasPaths = svc.visibleMenu(svc.active() as ModuleManifest).flatMap((s) => s.entries.map((e) => e.path));
    const compartida = comprasPaths.find((p) => p.startsWith('/reports/'));
    if (!compartida) return;

    events.next(new NavigationEnd(2, compartida, compartida));

    expect(svc.active()?.id).toBe('compras');
  });

  it('una URL que ningún módulo declara no inventa un módulo', () => {
    const svc = make('/no-existe/nada', todos());

    expect(svc.active()?.id).toBe('workspace');
  });

  it('no ofrece ninguna entrada que el servidor rechazaría', () => {
    const svc = make('/invoices', []);

    const ofrecidas = svc
      .visibleMenu(ventas)
      .flatMap((s) => s.entries.map((e) => e.path));
    const libres = ventas.routes
      .filter((r) => r.menu && r.permission === 'authenticated')
      .map((r) => '/' + [ventas.basePath, r.path].filter(Boolean).join('/'));

    expect(ofrecidas).toEqual(libres);
  });

  it('un módulo sin ninguna entrada permitida no es alcanzable', () => {
    const svc = make('/invoices', []);

    const compras = svc.reachable().find((r) => r.module.id === 'compras');
    expect(compras?.allowed).toBe(false);
    expect(compras?.target).toBeNull();
  });

  it('el punto de entrada de un módulo es una pantalla que se puede abrir', () => {
    const svc = make('/invoices', todos());

    for (const { module, allowed, target } of svc.reachable()) {
      expect(allowed).toBe(true);
      const permiso = svc
        .visibleMenu(module)
        .flatMap((s) => s.entries)
        .find((e) => e.path === target);
      expect(permiso).toBeDefined();
    }
  });

  it('marca la entrada más específica, no todas las que son prefijo', () => {
    // `/accounts-payable` is a prefix of `/accounts-payable/payments`, and both are menu entries.
    // Prefix matching would light both.
    const svc = make('/accounts-payable/payments', todos());

    expect(svc.activeEntry()).toBe('/accounts-payable/payments');
  });

  it('sigue marcando la sección mientras hay un documento abierto', () => {
    // `/invoices/:id` is not a menu entry. Exact matching would leave nothing lit while you read
    // an invoice, which is precisely when you most need to know where you are.
    const svc = make('/invoices/abc-123', todos());

    expect(svc.activeEntry()).toBe('/invoices');
  });

  it('los grupos del panel salen en su orden fijo', () => {
    const svc = make('/invoices', todos());

    const orden = ['inbox', 'documents', 'masters', 'analysis', 'configuration'];
    const grupos = svc.panel().map((s) => s.group);
    expect(grupos).toEqual(orden.filter((g) => grupos.includes(g as (typeof grupos)[number])));
  });

  describe('explorar un módulo sin abrir nada', () => {
    const contabilidad = MODULES.find((m) => m.id === 'contabilidad') as ModuleManifest;

    it('el panel enseña el módulo elegido; la ventana sigue siendo la que era', () => {
      const svc = make('/invoices', todos());

      svc.browse(contabilidad);

      expect(svc.active()?.id).toBe('contabilidad');
      expect(svc.current()?.id).toBe('ventas');
      expect(svc.isBrowsing()).toBe(true);
      // El panel es el del módulo explorado, y ninguna de sus entradas se marca: no está abierta.
      expect(svc.panel().length).toBeGreaterThan(0);
      expect(svc.activeEntry()).toBeNull();
    });

    it('elegir el módulo de la ventana es volver', () => {
      const svc = make('/invoices', todos());
      svc.browse(contabilidad);

      svc.browse(ventas);

      expect(svc.isBrowsing()).toBe(false);
      expect(svc.active()?.id).toBe('ventas');
    });

    it('cualquier navegación devuelve el panel a la ventana', () => {
      // Abrir una entrada, cambiar de pestaña, el botón atrás: en cuanto el usuario actúa, el panel
      // vuelve a describir lo que hay en pantalla. Es lo que impide que el estado guardado derive.
      const svc = make('/invoices', todos());
      svc.browse(contabilidad);

      events.next(new NavigationEnd(3, '/accounting/journals', '/accounting/journals'));

      expect(svc.isBrowsing()).toBe(false);
      expect(svc.active()?.id).toBe('contabilidad');
    });

    it('una página que ofrecen dos módulos se abre en el que se exploraba (QA C-05)', () => {
      const svc = make('/accounting/journals', todos());
      svc.browse(ventas);

      events.next(new NavigationEnd(4, '/reports/aging/receivables', '/reports/aging/receivables'));

      expect(svc.active()?.id).toBe('ventas');
    });
  });

  describe('destinos', () => {
    it('indexa por ruta, sin empresa, cada entrada que el puesto puede abrir', () => {
      const svc = make('/invoices', todos());

      const diarios = svc.destinations().get('/accounting/journals');
      expect(diarios?.module.id).toBe('contabilidad');
      expect(svc.destinations().has('/no-existe')).toBe(false);
    });

    it('no indexa lo que el servidor rechazaría', () => {
      const svc = make('/invoices', []);

      const rutas = [...svc.destinations().values()];
      expect(rutas.every((d) => d.module.routes.length > 0)).toBe(true);
      expect(svc.destinations().has('/accounting/journals')).toBe(false);
    });
  });

  it.each([
    ['/e/acme/accounting/journals', '/accounting/journals'],
    ['/accounting/journals/', '/accounting/journals'],
    ['accounting/journals?x=1#y', '/accounting/journals'],
    ['/e/acme', '/'],
  ])('normalizeRoute(%s) → %s', (raw, expected) => {
    expect(normalizeRoute(raw)).toBe(expected);
  });
});
