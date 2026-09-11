import { TestBed } from '@angular/core/testing';

import { TabPersistenceService } from './tab-persistence.service';
import { TabRouterService } from './tab-router.service';
import { TabStateService } from './tab-state.service';
import { TabType } from './tab.model';

/**
 * La restauración del espacio de trabajo no puede pisar la barra de direcciones.
 *
 * `restoreState()` reemplaza la lista de pestañas por la guardada, y eso borraba la pestaña que el
 * puente Router↔Workspace acababa de abrir para la URL con la que arrancó el navegador. Después
 * activaba la pestaña que estuviera activa al guardar, lo que además reescribía la URL. El efecto
 * era que ninguna página del producto se podía enlazar ni recargar: F5 sobre
 * `/accounting/chart-of-accounts` devolvía al usuario a Inicio.
 */
describe('TabPersistenceService · la URL de arranque manda', () => {
  const STORAGE_KEY = 'erp_tab_session';

  const persisted = (activeTabId: string) =>
    JSON.stringify({
      schemaVersion: 2,
      activeTabId,
      tabs: [
        {
          id: 'inicio',
          type: TabType.PINNED,
          title: 'PAGE_TITLES.HOME',
          icon: 'Home',
          route: '/overview',
          routeParams: {},
          isDirty: false,
          isCloseable: false,
          isPinned: true,
          createdAt: new Date().toISOString(),
          lastActivatedAt: new Date().toISOString(),
        },
      ],
    });

  let tabState: {
    setTabs: jest.Mock;
    ensureDefaultTab: jest.Mock;
    activateTab: jest.Mock;
    openTab: jest.Mock;
    tabs: () => unknown[];
    activeTabId: () => string | null;
  };
  let bootRoute: jest.Mock;

  const build = () => {
    tabState = {
      setTabs: jest.fn(),
      ensureDefaultTab: jest.fn(),
      activateTab: jest.fn(),
      openTab: jest.fn(),
      tabs: () => [],
      activeTabId: () => null,
    };
    bootRoute = jest.fn().mockReturnValue(null);

    TestBed.configureTestingModule({
      providers: [
        TabPersistenceService,
        { provide: TabStateService, useValue: tabState },
        { provide: TabRouterService, useValue: { bootRoute } },
      ],
    });
    return TestBed.inject(TabPersistenceService);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('abre la ruta con la que arrancó el navegador, no la pestaña guardada', () => {
    sessionStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue({ path: '/accounting/chart-of-accounts', query: {} });

    service.restoreState();

    expect(tabState.openTab).toHaveBeenCalledWith({
      route: '/accounting/chart-of-accounts',
      queryParams: {},
    });
    expect(tabState.activateTab).not.toHaveBeenCalled();
  });

  it('conserva los parámetros de consulta de la URL de arranque', () => {
    sessionStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue({ path: '/invoices', query: { status: 'overdue' } });

    service.restoreState();

    expect(tabState.openTab).toHaveBeenCalledWith({
      route: '/invoices',
      queryParams: { status: 'overdue' },
    });
  });

  it('vuelve a la última pestaña activa cuando no hay ruta de arranque', () => {
    sessionStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue(null); // raíz, login, pago: nada que respetar

    service.restoreState();

    expect(tabState.activateTab).toHaveBeenCalledWith('inicio');
    expect(tabState.openTab).not.toHaveBeenCalled();
  });

  it('restaura siempre la lista guardada, gane quien gane el foco', () => {
    sessionStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue({ path: '/my-work', query: {} });

    service.restoreState();

    expect(tabState.setTabs).toHaveBeenCalledTimes(1);
    expect(tabState.setTabs.mock.calls[0][0]).toHaveLength(1);
  });
});
