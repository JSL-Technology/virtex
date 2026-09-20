import { TestBed } from '@angular/core/testing';

import { TabPersistenceService } from './tab-persistence.service';
import { TabRouterService } from './tab-router.service';
import { TabStateService } from './tab-state.service';
import { ActiveOrganizationService } from '../tenancy/active-organization.service';
import { WorkspaceSyncService } from './workspace-sync.service';
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
  //  La clave lleva la empresa: `localStorage` lo comparten todas las pestañas del navegador, y
  //  con una sola clave abrir una segunda ventana en otra empresa sobrescribía el espacio de la
  //  primera.
  const STORAGE_KEY = 'erp_tab_session:cliente-a';

  /**
   * `localStorage` and `schemaVersion: 3` because that is what the service writes: the workspace
   * moved off `sessionStorage` so that "remember my tabs" survives closing the browser and not
   * merely an F5, and the persisted tab grew `queryParams`. A fixture frozen at the old storage
   * and the old version restores nothing, which is indistinguishable here from the regression this
   * file exists to catch.
   */
  const persisted = (activeTabId: string) =>
    JSON.stringify({
      schemaVersion: 3,
      activeTabId,
      tabs: [
        {
          id: 'inicio',
          type: TabType.PINNED,
          title: 'page_titles.home',
          icon: 'Home',
          route: '/overview',
          routeParams: {},
          queryParams: {},
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
  let slug: string | null;
  const remoteDouble = {
    pull: jest.fn().mockResolvedValue(null),
    push: jest.fn().mockResolvedValue({ saved: true }),
    forget: jest.fn().mockResolvedValue(undefined),
    resetRevision: jest.fn(),
  };

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
    slug = 'cliente-a';

    TestBed.configureTestingModule({
      providers: [
        TabPersistenceService,
        { provide: TabStateService, useValue: tabState },
        { provide: TabRouterService, useValue: { bootRoute } },
        // El espacio de trabajo se guarda por empresa, así que la persistencia necesita saber en
        // cuál está. Se provee un doble para no arrastrar AuthService —y con él HttpClient— a una
        // prueba que no habla con el servidor.
        { provide: ActiveOrganizationService, useValue: { slug: () => slug } },
        // El nivel remoto se prueba aparte; aquí se calla para que estas pruebas sigan siendo
        // sobre la restauración local y no sobre la red.
        { provide: WorkspaceSyncService, useValue: remoteDouble },
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
    localStorage.setItem(STORAGE_KEY, persisted('inicio'));
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
    localStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue({ path: '/invoices', query: { status: 'overdue' } });

    service.restoreState();

    expect(tabState.openTab).toHaveBeenCalledWith({
      route: '/invoices',
      queryParams: { status: 'overdue' },
    });
  });

  it('vuelve a la última pestaña activa cuando no hay ruta de arranque', () => {
    localStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue(null); // raíz, login, pago: nada que respetar

    service.restoreState();

    expect(tabState.activateTab).toHaveBeenCalledWith('inicio');
    expect(tabState.openTab).not.toHaveBeenCalled();
  });

  it('restaura siempre la lista guardada, gane quien gane el foco', () => {
    localStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();
    bootRoute.mockReturnValue({ path: '/my-work', query: {} });

    service.restoreState();

    expect(tabState.setTabs).toHaveBeenCalledTimes(1);
    expect(tabState.setTabs.mock.calls[0][0]).toHaveLength(1);
  });
  it('el espacio de trabajo de una empresa no se ve desde otra', () => {
    // Guardado mientras se trabajaba en «cliente-a».
    localStorage.setItem(STORAGE_KEY, persisted('inicio'));
    const service = build();

    // La misma sesión, otra ventana, otra empresa.
    slug = 'cliente-b';
    service.restoreState();

    // Nada que restaurar allí: se abre la pestaña por defecto de esa empresa en vez de heredar
    // las pestañas —y los documentos abiertos— del inquilino anterior.
    expect(tabState.setTabs).not.toHaveBeenCalled();
    expect(tabState.ensureDefaultTab).toHaveBeenCalled();
  });

});
