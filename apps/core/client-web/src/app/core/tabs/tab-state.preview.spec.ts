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
import { TabType, TabDefinition } from './tab.model';

/**
 * ¿Funciona de verdad «vista previa al abrir»? Esta prueba ejerce el WorkspaceStore aislado —sin
 * router, sin Dockview, sin DOM— para separar la lógica del área de trabajo de su integración.
 *
 * Si estas aserciones pasan, el store hace su parte: hojear registros reutiliza UNA pestaña.
 */

const recordDef: TabDefinition = {
  pattern: '/invoices/:id',
  tabType: TabType.RECORD,
  icon: 'Receipt',
  title: 'Invoice',
  isCloseable: true,
  entityKeyFn: (p) => `invoice:${p['id']}`,
  load: () => Promise.resolve(class {}),
};

const listDef: TabDefinition = {
  pattern: '/invoices',
  tabType: TabType.MODULE_LIST,
  icon: 'List',
  title: 'Invoices',
  isCloseable: true,
  entityKeyFn: () => 'module:/invoices',
  load: () => Promise.resolve(class {}),
};

/** A window to work FROM (the relationship map): never the reusable preview. */
const canvasDef: TabDefinition = {
  pattern: '/map/:id',
  tabType: TabType.WIZARD,
  icon: 'Share2',
  title: 'Map',
  isCloseable: true,
  previewable: false,
  entityKeyFn: (p) => `map:${p['id']}`,
  load: () => Promise.resolve(class {}),
};

function resolve(route: string) {
  const map = route.match(/^\/map\/(\w+)$/);
  if (map) return { definition: canvasDef, params: { id: map[1] }, isFallback: false };
  const m = route.match(/^\/invoices\/(\w+)$/);
  if (m) return { definition: recordDef, params: { id: m[1] }, isFallback: false };
  return { definition: listDef, params: {}, isFallback: false };
}

describe('TabStateService — vista previa al abrir', () => {
  let tabs: TabStateService;
  const enablePreview = signal(true);
  const langChange = new Subject<void>();
  let lang = 'en';

  beforeEach(() => {
    enablePreview.set(true);
    lang = 'en';
    TestBed.configureTestingModule({
      providers: [
        TabStateService,
        { provide: TabRegistryService, useValue: { resolve, canOpen: () => true } },
        { provide: TabPreferencesService, useValue: { enablePreview, maxTabs: () => 12 } },
        { provide: DialogService, useValue: { confirmClose: () => Promise.resolve('discard') } },
        { provide: NotificationService, useValue: { showWarning: jest.fn(), showInfo: jest.fn() } },
        { provide: TabEventBusService, useValue: { on: () => of(), emit: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (k: string) => `${lang}:${k}`, onLangChange: langChange } },
      ],
    });
    tabs = TestBed.inject(TabStateService);
  });

  it('con la preferencia ACTIVADA, hojear registros reutiliza UNA sola pestaña', () => {
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.tabs().length).toBe(1);
    expect(tabs.tabs()[0].isPreview).toBe(true);
    expect(tabs.tabs()[0].route).toBe('/invoices/88');

    tabs.openTab({ route: '/invoices/89' });
    expect(tabs.tabs().length).toBe(1); // reutiliza, no acumula
    expect(tabs.tabs()[0].route).toBe('/invoices/89'); // y muestra el nuevo
    expect(tabs.tabs()[0].isPreview).toBe(true);
  });

  it('recorrer módulos del menú sin tocar nada deja UNA sola pestaña (como VS Code)', () => {
    tabs.openTab({ route: '/invoices' });
    tabs.openTab({ route: '/invoices/88' });
    tabs.openTab({ route: '/invoices' });
    expect(tabs.tabs().length).toBe(1);
    expect(tabs.tabs()[0]).toMatchObject({ route: '/invoices', isPreview: true });
  });

  it('una vista previa con cambios se queda; lo siguiente se abre al lado', () => {
    tabs.openTab({ route: '/invoices' });
    tabs.markDirty(tabs.tabs()[0].id);
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.tabs().map((t) => [t.route, t.isPreview])).toEqual([
      ['/invoices', false],
      ['/invoices/88', true],
    ]);
  });

  it('abrir algo DESDE la vista previa (una fila de su lista) la fija en vez de reemplazarla', () => {
    tabs.openTab({ route: '/invoices' });
    tabs.noteContentInteraction(tabs.tabs()[0].id);
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.tabs().map((t) => [t.route, t.isPreview])).toEqual([
      ['/invoices', false],
      ['/invoices/88', true],
    ]);
  });

  it('una pulsación fuera del contenido (el menú) olvida esa interacción', () => {
    tabs.openTab({ route: '/invoices' });
    tabs.noteContentInteraction(tabs.tabs()[0].id);
    document.dispatchEvent(new Event('pointerdown'));
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.tabs().map((t) => t.route)).toEqual(['/invoices/88']);
  });

  it('un enlace de fuera (marcador, enlace compartido) abre una pestaña permanente', () => {
    tabs.openTab({ route: '/invoices' });
    tabs.openFromLink('/invoices/88');
    expect(tabs.tabs().map((t) => [t.route, t.isPreview])).toEqual([
      ['/invoices', true],
      ['/invoices/88', false],
    ]);
  });

  it('recargar (F5) sobre una vista previa la enfoca sin fijarla', () => {
    tabs.openTab({ route: '/invoices/88' });
    tabs.openFromLink('/invoices/88');
    expect(tabs.tabs().map((t) => [t.route, t.isPreview])).toEqual([['/invoices/88', true]]);
  });

  it('preview:false (intención «permanente») abre pestaña propia y no reutiliza', () => {
    tabs.openTab({ route: '/invoices/88', preview: false });
    tabs.openTab({ route: '/invoices/89', preview: false });
    expect(tabs.tabs().length).toBe(2);
    expect(tabs.tabs().every((t) => !t.isPreview)).toBe(true);
  });

  it('una preview fijada (markPermanent) deja de reutilizarse: el siguiente abre otra', () => {
    tabs.openTab({ route: '/invoices/88' });
    tabs.markPermanent(tabs.tabs()[0].id);
    tabs.openTab({ route: '/invoices/89' });
    expect(tabs.tabs().length).toBe(2);
  });

  it('con la preferencia DESACTIVADA, cada apertura es permanente y separada', () => {
    enablePreview.set(false);
    tabs.openTab({ route: '/invoices/88' });
    tabs.openTab({ route: '/invoices/89' });
    expect(tabs.tabs().length).toBe(2);
    expect(tabs.tabs().every((t) => !t.isPreview)).toBe(true);
  });

  it('a non-previewable window is never a preview, and the document opened from it gets its own tab', () => {
    tabs.openTab({ route: '/map/1' });
    expect(tabs.tabs()[0].isPreview).toBe(false);
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.tabs().map((t) => t.route)).toEqual(['/map/1', '/invoices/88']);
  });

  it('never reuses a non-previewable window persisted as a preview by an older build', () => {
    tabs.setTabs([
      { id: 't1', type: TabType.WIZARD, title: 'Map', icon: 'Share2', route: '/map/1', isDirty: false, isLoading: false, isCloseable: true, isPinned: false, isPreview: true, entityKey: 'map:1', createdAt: new Date(), lastActivatedAt: new Date(), order: 0 },
    ] as never);
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.tabs().map((t) => t.route)).toEqual(['/map/1', '/invoices/88']);
  });

  it('heals a restored list: keys follow routes, duplicates collapse, one preview at most', () => {
    const base = { type: TabType.RECORD, title: 'x', icon: 'x', isDirty: false, isLoading: false, isCloseable: true, isPinned: false, createdAt: new Date(), lastActivatedAt: new Date() };
    tabs.setTabs([
      // Shows the map but claims to be invoice 88 — written by an older build.
      { ...base, id: 'a', route: '/map/1', entityKey: 'invoice:88', isPreview: true, order: 0 },
      { ...base, id: 'b', route: '/invoices/88', entityKey: 'invoice:88', isPreview: true, order: 1 },
      { ...base, id: 'c', route: '/invoices/88', entityKey: 'invoice:88', isPreview: false, order: 2 },
      { ...base, id: 'd', route: '/invoices/90', entityKey: 'invoice:90', isPreview: true, order: 3 },
    ] as never);
    expect(tabs.tabs().map((t) => [t.id, t.entityKey, t.isPreview])).toEqual([
      ['a', 'map:1', false],
      ['b', 'invoice:88', true],
      ['d', 'invoice:90', false],
    ]);
    tabs.openTab({ route: '/invoices/88' });
    expect(tabs.activeTabId()).toBe('b');
  });

  it('a restored tab titled from the catalogue comes back in the language in use, not the saved one', () => {
    const base = { type: TabType.MODULE_LIST, icon: 'x', isDirty: false, isLoading: false, isCloseable: true, isPinned: false, isPreview: false, createdAt: new Date(), lastActivatedAt: new Date() };
    lang = 'es';
    tabs.setTabs([
      { ...base, id: 'a', route: '/invoices', title: 'Invoices', titleKey: 'page_titles.invoices', order: 0 },
      { ...base, id: 'b', route: '/invoices/88', title: 'Invoice E310000000001', order: 1 },
    ] as never);
    expect(tabs.tabs().map((t) => t.title)).toEqual(['es:page_titles.invoices', 'Invoice E310000000001']);
  });

  it('a tab titled from the catalogue follows a language change; a document title does not', () => {
    tabs.openTab({ route: '/invoices', preview: false });
    tabs.openTab({ route: '/invoices/88', preview: false });
    const [list, record] = tabs.tabs();
    tabs.updateTitle(record.id, 'Invoice E310000000001');
    expect(tabs.tabs().find((t) => t.id === list.id)?.title).toBe('en:Invoices');

    lang = 'es';
    langChange.next();

    expect(tabs.tabs().find((t) => t.id === list.id)?.title).toBe('es:Invoices');
    expect(tabs.tabs().find((t) => t.id === record.id)?.title).toBe('Invoice E310000000001');
  });
});
