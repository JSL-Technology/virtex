import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
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

function resolve(route: string) {
  const m = route.match(/^\/invoices\/(\w+)$/);
  if (m) return { definition: recordDef, params: { id: m[1] }, isFallback: false };
  return { definition: listDef, params: {}, isFallback: false };
}

describe('TabStateService — vista previa al abrir', () => {
  let tabs: TabStateService;
  const enablePreview = signal(true);

  beforeEach(() => {
    enablePreview.set(true);
    TestBed.configureTestingModule({
      providers: [
        TabStateService,
        { provide: TabRegistryService, useValue: { resolve, canOpen: () => true } },
        { provide: TabPreferencesService, useValue: { enablePreview } },
        { provide: DialogService, useValue: { confirmClose: () => Promise.resolve('discard') } },
        { provide: NotificationService, useValue: { showWarning: jest.fn(), showInfo: jest.fn() } },
        { provide: TabEventBusService, useValue: { on: () => of(), emit: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
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
});
