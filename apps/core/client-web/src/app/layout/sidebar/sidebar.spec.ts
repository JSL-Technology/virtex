import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { Sidebar } from './sidebar';
import { ActiveModuleService, Destination, PanelSection } from '../../core/modules/active-module.service';
import { GROUP_LABEL } from '../../core/modules/menu-labels';
import { moduleIcon } from '../../core/modules/module-icons';
import { ModuleManifest } from '../../core/modules/module-manifest';
import { FavoritesService } from '../../core/navigation/favorites.service';
import { NavigationActionsService } from '../../core/navigation/navigation-actions.service';
import { provideTranslateService } from '@ngx-translate/core';

/**
 * The module panel answers one question: what is there to do inside the module I am in.
 *
 * What it renders is `ActiveModuleService.panel()` — already resolved from the URL and already
 * filtered to the seat's permissions — so these tests are about presentation and gestures: the
 * module is named, the groups keep the order they arrive in, an empty module explains itself,
 * exactly one entry is lit, browsing another module offers the way back, and each gesture on an
 * entry asks for the right way of opening it. The rules behind them are covered in the services'
 * own specs.
 */
describe('Sidebar (panel de módulo)', () => {
  let fixture: ComponentFixture<Sidebar>;

  const ventas = { id: 'ventas', titleKey: 'modules.sales' } as ModuleManifest;
  const contabilidad = { id: 'contabilidad', titleKey: 'modules.accounting' } as ModuleManifest;
  const entry = (path: string) => ({ path, labelKey: `X.${path}`, icon: moduleIcon('FileText') });
  const destination = (route: string, module: ModuleManifest): Destination => ({
    ...entry(`/e/acme${route}`),
    route,
    module,
  });

  const navigation = { open: jest.fn(), copyLink: jest.fn() };
  const stopBrowsing = jest.fn();
  let favoriteItems = signal<Destination[]>([]);
  const favorites = {
    items: favoriteItems.asReadonly(),
    toggle: jest.fn(),
    isFavorite: (route: string) => favoriteItems().some((f) => f.route === route),
    move: jest.fn(),
  };

  async function render(
    panel: PanelSection[],
    options: { activeEntry?: string | null; browsing?: boolean; currentRoute?: string } = {},
  ) {
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        {
          provide: ActiveModuleService,
          useValue: {
            active: signal(ventas).asReadonly(),
            current: signal(options.browsing ? contabilidad : ventas).asReadonly(),
            isBrowsing: signal(options.browsing ?? false).asReadonly(),
            panel: signal(panel).asReadonly(),
            activeEntry: signal(options.activeEntry ?? null).asReadonly(),
            currentRoute: signal(options.currentRoute ?? '/').asReadonly(),
            destinations: signal(new Map()).asReadonly(),
            stopBrowsing,
          },
        },
        { provide: FavoritesService, useValue: favorites },
        { provide: NavigationActionsService, useValue: navigation },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    favoriteItems = signal<Destination[]>([]);
    (favorites as { items: unknown }).items = favoriteItems.asReadonly();
    localStorage.clear();
  });

  afterEach(() => TestBed.resetTestingModule());

  const panelCompleto: PanelSection[] = [
    { group: 'inbox', labelKey: GROUP_LABEL.inbox, entries: [entry('/e/acme/approvals')] },
    {
      group: 'documents',
      labelKey: GROUP_LABEL.documents,
      entries: [entry('/e/acme/invoices'), entry('/e/acme/invoices/pending')],
    },
    { group: 'masters', labelKey: GROUP_LABEL.masters, entries: [entry('/e/acme/customers')] },
  ];

  it('nombra el módulo en el que estás', async () => {
    const el = await render(panelCompleto);

    expect(el.querySelector('.module-title')?.textContent?.trim()).toBe('modules.sales');
  });

  it('respeta el orden de los grupos que recibe', async () => {
    const el = await render(panelCompleto);

    const titles = [...el.querySelectorAll('.group-title')].map((h) => h.textContent?.trim());
    expect(titles).toEqual(['shell.group_inbox', 'shell.group_documents', 'shell.group_masters']);
  });

  it('marca una sola entrada activa', async () => {
    // Two entries are given, one of them a prefix of the other. The longest-prefix rule in the
    // service picks which is lit; the panel must not add a second highlight of its own.
    const el = await render(panelCompleto, { activeEntry: '/e/acme/invoices' });

    const activos = [...el.querySelectorAll('a.menu-item.active')];
    expect(activos.length).toBe(1);
    expect(activos[0].getAttribute('href')).toBe('/e/acme/invoices');
    expect(activos[0].getAttribute('aria-current')).toBe('page');
  });

  it('explica un módulo vacío en vez de dejar una columna en blanco', async () => {
    // A blank column reads as a breakage. Saying why is the difference between "no tienes permiso"
    // and "esto está roto".
    const el = await render([]);

    expect(el.querySelector('.menu-empty')?.textContent?.trim()).toBe('shell.no_entries');
    expect(el.querySelectorAll('a.menu-item').length).toBe(0);
  });

  describe('explorando otro módulo', () => {
    it('lo dice, y ofrece volver al módulo de la ventana', async () => {
      const el = await render(panelCompleto, { browsing: true });

      expect(el.querySelector('.browsing__hint')).not.toBeNull();
      (el.querySelector('.browsing__back') as HTMLButtonElement).click();
      expect(stopBrowsing).toHaveBeenCalled();
    });

    it('Escape también vuelve', async () => {
      const el = await render(panelCompleto, { browsing: true });

      el.querySelector('nav')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(stopBrowsing).toHaveBeenCalled();
    });

    it('sin explorar no hay franja ni vuelta que ofrecer', async () => {
      const el = await render(panelCompleto);

      expect(el.querySelector('.browsing')).toBeNull();
    });
  });

  describe('los gestos sobre una entrada', () => {
    it('doble clic la abre y la deja fija', async () => {
      const el = await render(panelCompleto);

      el.querySelector('a.menu-item')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      expect(navigation.open).toHaveBeenCalledWith('/e/acme/approvals', 'permanent');
    });

    it('la estrella la añade o quita de favoritos, sin abrirla', async () => {
      const el = await render(panelCompleto);

      (el.querySelector('.menu-star') as HTMLButtonElement).click();
      expect(favorites.toggle).toHaveBeenCalledWith('/approvals');
      expect(navigation.open).not.toHaveBeenCalled();
    });

    it('la estrella de una entrada que ya es favorita se queda visible y lo dice', async () => {
      favoriteItems.set([destination('/customers', ventas)]);
      const el = await render(panelCompleto);

      const stars = [...el.querySelectorAll('.menu-group:not(.menu-group--favorites) .menu-star')];
      const pressed = stars.map((s) => s.getAttribute('aria-pressed'));
      expect(pressed).toEqual(['false', 'false', 'false', 'true']);
    });

    it('cada entrada tiene un menú contextual', async () => {
      const el = await render(panelCompleto);

      el.querySelector('a.menu-item')!.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
      );
      fixture.detectChanges();

      const items = [...document.querySelectorAll('.entry-menu [role="menuitem"]')].map((i) =>
        i.querySelector('.entry-menu__label')?.textContent?.trim(),
      );
      expect(items).toEqual([
        'shell.nav.open',
        'shell.nav.open_new_tab',
        'shell.nav.open_to_side',
        'shell.nav.open_in_background',
        'shell.nav.open_new_window',
        'shell.favorites.add',
        'shell.nav.copy_link',
      ]);

      (document.querySelectorAll('.entry-menu [role="menuitem"]')[2] as HTMLButtonElement).click();
      expect(navigation.open).toHaveBeenCalledWith('/approvals', 'side');
    });
  });

  describe('favoritos', () => {
    it('aparecen arriba, en su orden, con el módulo de los que no son de este panel', async () => {
      favoriteItems.set([destination('/accounting/journals', contabilidad), destination('/customers', ventas)]);
      const el = await render(panelCompleto);

      const rows = [...el.querySelectorAll('#favorites-list .menu-item')];
      expect(rows.map((r) => r.querySelector('.label')?.textContent?.trim())).toEqual([
        'X./e/acme/accounting/journals',
        'X./e/acme/customers',
      ]);
      expect(rows.map((r) => r.querySelector('.item-module')?.textContent?.trim() ?? null)).toEqual([
        'modules.accounting',
        null,
      ]);
    });

    it('se ilumina el favorito de la página abierta, aunque sea de otro módulo', async () => {
      favoriteItems.set([destination('/accounting/journals', contabilidad)]);
      const el = await render(panelCompleto, { currentRoute: '/accounting/journals/5/edit' });

      expect(el.querySelector('#favorites-list .menu-item.active')).not.toBeNull();
    });

    it('la sección se pliega y recuerda que se plegó', async () => {
      favoriteItems.set([destination('/customers', ventas)]);
      const el = await render(panelCompleto);

      (el.querySelector('.group-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(el.querySelector('#favorites-list')).toBeNull();
      expect(el.querySelector('.group-toggle')?.getAttribute('aria-expanded')).toBe('false');
      expect(localStorage.getItem('virtex.nav.favorites.collapsed')).toBe('true');
    });

    it('sin favoritos no hay sección vacía', async () => {
      const el = await render(panelCompleto);

      expect(el.querySelector('.menu-group--favorites')).toBeNull();
    });
  });

  it('al cerrar el menú sin dejar el foco en ningún sitio, el foco vuelve a la entrada', async () => {
    jest.useFakeTimers();
    try {
      const el = await render(panelCompleto);
      const link = el.querySelector('a.menu-item') as HTMLElement;
      const component = fixture.componentInstance as unknown as {
        menuOpenedFrom(origin: HTMLElement): void;
        menuClosed(): void;
      };

      component.menuOpenedFrom(link);
      (document.activeElement as HTMLElement | null)?.blur();
      component.menuClosed();
      jest.runAllTimers();

      expect(document.activeElement).toBe(link);
    } finally {
      jest.useRealTimers();
    }
  });
});
