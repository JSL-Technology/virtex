import { TestBed } from '@angular/core/testing';

import { TabPersistenceService } from './tab-persistence.service';
import { TabRouterService } from './tab-router.service';
import { TabStateService } from './tab-state.service';
import { TabType } from './tab.model';
import { ActiveOrganizationService } from '../tenancy/active-organization.service';
import { WorkspaceSyncService } from './workspace-sync.service';

/**
 * «Continuar en otro equipo» solo vale si no cuesta las pestañas del primero.
 *
 * Estas pruebas cubren el camino que va del servidor a la pantalla: adoptar lo que otro equipo
 * abrió, no pisar lo que hay, y resolver el choque cuando los dos escriben a la vez.
 */
describe('Espacio de trabajo en el servidor', () => {
  const SCHEMA_VERSION = 3;

  const persistedTab = (route: string, extra: Record<string, unknown> = {}) => ({
    id: route,
    type: TabType.LIST,
    title: route,
    icon: 'File',
    route,
    routeParams: {},
    isDirty: false,
    isCloseable: true,
    isPinned: false,
    createdAt: new Date('2026-01-01').toISOString(),
    lastActivatedAt: new Date('2026-01-01').toISOString(),
    ...extra,
  });

  const workspace = (routes: string[]) => ({
    schemaVersion: SCHEMA_VERSION,
    activeTabId: routes[0] ?? null,
    tabs: routes.map((r) => persistedTab(r)),
  });

  let tabs: ReturnType<typeof makeState>;
  let remote: {
    pull: jest.Mock;
    push: jest.Mock;
    forget: jest.Mock;
    resetRevision: jest.Mock;
  };

  const makeState = () => {
    const list: unknown[] = [];
    return {
      list,
      tabs: () => list as never[],
      activeTabId: () => null,
      setTabs: jest.fn((next: unknown[]) => {
        list.length = 0;
        list.push(...next);
      }),
      ensureDefaultTab: jest.fn(),
      activateTab: jest.fn(),
      openTab: jest.fn(),
    };
  };

  const build = () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        TabPersistenceService,
        { provide: TabStateService, useValue: tabs },
        { provide: TabRouterService, useValue: { bootRoute: () => null } },
        { provide: ActiveOrganizationService, useValue: { slug: () => 'cliente-a' } },
        { provide: WorkspaceSyncService, useValue: remote },
      ],
    });
    return TestBed.inject(TabPersistenceService);
  };

  beforeEach(() => {
    localStorage.clear();
    // Los dobles se crean ANTES de construir el servicio para que cada prueba pueda decidir qué
    // responde el servidor antes de que nadie lo consulte.
    tabs = makeState();
    remote = {
      pull: jest.fn().mockResolvedValue(null),
      push: jest.fn().mockResolvedValue({ saved: true }),
      forget: jest.fn().mockResolvedValue(undefined),
      resetRevision: jest.fn(),
    };
  });

  it('adopta las pestañas que otro equipo dejó abiertas', async () => {
    remote.pull.mockResolvedValue({
      schemaVersion: SCHEMA_VERSION,
      payload: workspace(['/accounting/journal-entries']),
      revision: 4,
      updatedAt: new Date().toISOString(),
    });

    const service = build();
    service.restoreState();
    await Promise.resolve();
    await Promise.resolve();

    expect(tabs.setTabs).toHaveBeenCalled();
    const adoptadas = tabs.setTabs.mock.calls.at(-1)?.[0] as Array<{ route: string }>;
    expect(adoptadas.map((t) => t.route)).toContain('/accounting/journal-entries');
  });

  it('un espacio escrito por otra versión del cliente no se restaura a medias', async () => {
    remote.pull.mockResolvedValue({
      schemaVersion: SCHEMA_VERSION + 1,
      payload: workspace(['/lo-que-sea']),
      revision: 9,
      updatedAt: new Date().toISOString(),
    });

    const service = build();
    service.restoreState();
    await Promise.resolve();
    await Promise.resolve();

    expect(tabs.setTabs).not.toHaveBeenCalled();
  });

  it('si el servidor no responde, el espacio local sigue en pie', async () => {
    remote.pull.mockResolvedValue(null);

    const service = build();
    service.restoreState();
    await Promise.resolve();

    expect(tabs.ensureDefaultTab).toHaveBeenCalled();
    expect(tabs.setTabs).not.toHaveBeenCalled();
  });

  it('desactivar «recordar pestañas» también lo olvida en el servidor', () => {
    const service = build();
    service.restoreState();
    service.setRemember(false);

    expect(remote.forget).toHaveBeenCalled();
  });
});
