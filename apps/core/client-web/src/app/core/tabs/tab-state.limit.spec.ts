import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';
import { TabStateService } from './tab-state.service';
import { TabRegistryService } from './tab-registry.service';
import { TabPreferencesService } from './tab-preferences.service';
import { DialogService } from '../services/dialog.service';
import { NotificationService } from '../services/notification';
import { TabEventBusService } from './tab-event-bus.service';
import { TranslateService } from '@ngx-translate/core';
import { TabModel, TabType, TabDefinition } from './tab.model';

/**
 * The tab limit holds for a restored workspace too (QA A-04).
 *
 * Opening a tab respected the cap, but restoring took the saved list whole, so a few days of use
 * came back as 40 tabs: titles cut to six letters and every hidden page loading its data.
 */

const listDef: TabDefinition = {
  pattern: '/x',
  tabType: TabType.MODULE_LIST,
  icon: 'List',
  title: 'X',
  isCloseable: true,
  entityKeyFn: () => 'module:/x',
  load: () => Promise.resolve(class {}),
};

function savedTab(i: number, extra: Partial<TabModel> = {}): TabModel {
  return {
    id: `t${i}`,
    type: TabType.MODULE_LIST,
    title: `Tab ${i}`,
    icon: 'List',
    route: `/screen-${i}`,
    routeParams: {},
    isDirty: false,
    isLoading: false,
    isCloseable: true,
    isPinned: false,
    isPreview: false,
    entityKey: `module:/screen-${i}`,
    createdAt: new Date(2026, 0, 1),
    //  Tab i was used at minute i: higher numbers are more recent.
    lastActivatedAt: new Date(2026, 0, 1, 0, i),
    order: i,
    ...extra,
  };
}

describe('TabStateService — tope de pestañas', () => {
  let tabs: TabStateService;
  const maxTabs = signal(12);

  beforeEach(() => {
    maxTabs.set(12);
    TestBed.configureTestingModule({
      providers: [
        TabStateService,
        //  Keyed by route, as the real registry does: one shared key would fold every saved tab into one.
        {
          provide: TabRegistryService,
          useValue: {
            resolve: (route: string) => ({ definition: { ...listDef, entityKeyFn: () => `module:${route}` }, params: {}, isFallback: false }),
            canOpen: () => true,
          },
        },
        {
          provide: TabPreferencesService,
          useValue: { enablePreview: () => false, maxTabs, setMaxTabs: (v: number) => maxTabs.set(v) },
        },
        { provide: DialogService, useValue: { confirmClose: () => Promise.resolve('discard') } },
        { provide: NotificationService, useValue: { showWarning: jest.fn(), showInfo: jest.fn() } },
        { provide: TabEventBusService, useValue: { on: () => of(), emit: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (k: string) => k, onLangChange: new Subject<void>() } },
      ],
    });
    tabs = TestBed.inject(TabStateService);
  });

  it('un espacio restaurado con 40 pestañas vuelve con el tope, conservando las más recientes', () => {
    tabs.setTabs(Array.from({ length: 40 }, (_, i) => savedTab(i)));

    expect(tabs.tabs().length).toBe(12);
    expect(tabs.tabs().map((t) => t.id)).toEqual(Array.from({ length: 12 }, (_, i) => `t${28 + i}`));
  });

  it('nunca cierra una fijada, una con cambios sin guardar ni la activa', () => {
    const saved = Array.from({ length: 40 }, (_, i) => savedTab(i));
    saved[0] = savedTab(0, { isPinned: true });
    saved[1] = savedTab(1, { isDirty: true });
    tabs.setTabs(saved);
    tabs.activateTab('t2');
    tabs.setTabs(tabs.tabs().concat(savedTab(2)).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i));

    const ids = tabs.tabs().map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(['t0', 't1']));
    expect(ids.length).toBe(12);
  });

  it('bajar el tope cierra al momento las menos usadas', () => {
    tabs.setTabs(Array.from({ length: 12 }, (_, i) => savedTab(i)));

    tabs.setMaxTabs(8);

    expect(tabs.tabs().length).toBe(8);
    expect(tabs.tabs().map((t) => t.id)).toEqual(['t4', 't5', 't6', 't7', 't8', 't9', 't10', 't11']);
  });
});
