import { TestBed } from '@angular/core/testing';
import { TabStateService } from './tab-state.service';
import { TabRegistryService } from './tab-registry.service';
import { TabPreferencesService } from './tab-preferences.service';
import { DialogService } from '../services/dialog.service';
import { NotificationService } from '../services/notification';
import { TabEventBusService } from './tab-event-bus.service';
import { AuthService } from '../services/auth';
import { TranslateService } from '@ngx-translate/core';

/**
 * ¿La vista previa funciona con las RUTAS REALES de cada módulo?
 *
 * Usa el `TabRegistryService` real (resuelve contra los manifests de verdad), así que si una lista
 * enlaza a una ruta de detalle que ningún manifest declara, `resolve` cae en la definición genérica
 * (MODULE_LIST, «en construcción»), que NO es hojeable → la pestaña nunca es preview. Este test
 * revela exactamente esos casos, módulo por módulo.
 */
describe('Vista previa — rutas reales por módulo', () => {
  function freshStore(): TabStateService {
    TestBed.resetTestingModule();
    localStorage.setItem('virtex.tabs.enablePreview', 'true');
    TestBed.configureTestingModule({
      providers: [
        TabStateService,
        TabRegistryService,
        TabPreferencesService,
        { provide: AuthService, useValue: { hasPermissions: () => true } },
        { provide: DialogService, useValue: { confirmClose: () => Promise.resolve('discard') } },
        { provide: NotificationService, useValue: { showWarning: jest.fn(), showInfo: jest.fn() } },
        { provide: TabEventBusService, useValue: { on: () => ({ subscribe: () => ({ unsubscribe() {} }) }), emit: jest.fn() } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
      ],
    });
    return TestBed.inject(TabStateService);
  }

  /** Abre dos registros del mismo tipo y devuelve cuántas pestañas quedan y si la primera es preview. */
  function browseTwo(a: string, b: string): { count: number; isPreview: boolean } {
    const store = freshStore();
    store.openTab({ route: a });
    store.openTab({ route: b });
    const list = store.tabs();
    return { count: list.length, isPreview: list[0]?.isPreview ?? false };
  }

  // path del enlace de la lista → dos instancias
  const cases: Array<{ module: string; a: string; b: string; shouldPreview: boolean }> = [
    { module: 'Facturas (/invoices/:id)', a: '/invoices/88', b: '/invoices/89', shouldPreview: true },
    { module: 'Cuentas por pagar (/accounts-payable/:id)', a: '/accounts-payable/5', b: '/accounts-payable/6', shouldPreview: true },
    { module: 'Proveedores (/masters/suppliers/:id/edit)', a: '/masters/suppliers/5/edit', b: '/masters/suppliers/6/edit', shouldPreview: true },
    { module: 'Listas de precios (/masters/price-lists/:id/edit)', a: '/masters/price-lists/5/edit', b: '/masters/price-lists/6/edit', shouldPreview: true },
    { module: 'Clientes (/contacts/customers/:id/edit)', a: '/contacts/customers/5/edit', b: '/contacts/customers/6/edit', shouldPreview: true },
    // Rutas de edición de contabilidad añadidas al manifest (antes caían en «en construcción»):
    { module: 'Libros mayores (/accounting/general-ledger/:id/edit)', a: '/accounting/general-ledger/5/edit', b: '/accounting/general-ledger/6/edit', shouldPreview: true },
    { module: 'Diarios (/accounting/journals/:id/edit)', a: '/accounting/journals/5/edit', b: '/accounting/journals/6/edit', shouldPreview: true },
  ];

  for (const c of cases) {
    it(`${c.module}: ${c.shouldPreview ? 'reutiliza UNA preview' : 'no previsualiza'}`, () => {
      const { count, isPreview } = browseTwo(c.a, c.b);
      // Documenta el comportamiento REAL en el nombre; la aserción exige que la vista previa funcione.
      // eslint-disable-next-line no-console
      console.log(`[preview] ${c.module} -> tabs=${count} isPreview=${isPreview}`);
      expect({ count, isPreview }).toEqual({ count: 1, isPreview: true });
    });
  }
});
