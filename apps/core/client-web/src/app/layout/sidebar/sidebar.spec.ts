import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Sidebar } from './sidebar';
import { ActiveModuleService, PanelSection } from '../../core/modules/active-module.service';
import { GROUP_LABEL } from '../../core/modules/menu-labels';
import { moduleIcon } from '../../core/modules/module-icons';
import { ModuleManifest } from '../../core/modules/module-manifest';

/**
 * The module panel answers one question: what is there to do inside the module I am in.
 *
 * What it renders is `ActiveModuleService.panel()` — already resolved from the URL and already
 * filtered to the seat's permissions — so these tests are about presentation: the module is named,
 * the groups keep the order they arrive in, an empty module explains itself, and exactly one entry
 * is lit. The rule that produces the panel is covered in `active-module.service.spec.ts`.
 */
describe('Sidebar (panel de módulo)', () => {
  let fixture: ComponentFixture<Sidebar>;

  const ventas = { id: 'ventas', titleKey: 'MODULES.SALES' } as ModuleManifest;
  const entry = (path: string) => ({ path, labelKey: `X.${path}`, icon: moduleIcon('FileText') });

  async function render(panel: PanelSection[], activeEntry: string | null = null) {
    await TestBed.configureTestingModule({
      imports: [Sidebar, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        {
          provide: ActiveModuleService,
          useValue: {
            active: signal(ventas).asReadonly(),
            panel: signal(panel).asReadonly(),
            activeEntry: signal(activeEntry).asReadonly(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  const panelCompleto: PanelSection[] = [
    { group: 'inbox', labelKey: GROUP_LABEL.inbox, entries: [entry('/my-work')] },
    {
      group: 'documents',
      labelKey: GROUP_LABEL.documents,
      entries: [entry('/invoices'), entry('/invoices/pending')],
    },
    { group: 'masters', labelKey: GROUP_LABEL.masters, entries: [entry('/customers')] },
  ];

  it('nombra el módulo en el que estás', async () => {
    const el = await render(panelCompleto);

    expect(el.querySelector('.module-title')?.textContent?.trim()).toBe('MODULES.SALES');
  });

  it('respeta el orden de los grupos que recibe', async () => {
    const el = await render(panelCompleto);

    const titles = [...el.querySelectorAll('.group-title')].map((h) => h.textContent?.trim());
    expect(titles).toEqual(['SHELL.GROUP_INBOX', 'SHELL.GROUP_DOCUMENTS', 'SHELL.GROUP_MASTERS']);
  });

  it('marca una sola entrada activa', async () => {
    // Two entries are given, one of them a prefix of the other. The longest-prefix rule in the
    // service picks which is lit; the panel must not add a second highlight of its own.
    const el = await render(panelCompleto, '/invoices');

    const activos = [...el.querySelectorAll('a.menu-item.active')];
    expect(activos.length).toBe(1);
    expect(activos[0].getAttribute('href')).toBe('/invoices');
    expect(activos[0].getAttribute('aria-current')).toBe('page');
  });

  it('explica un módulo vacío en vez de dejar una columna en blanco', async () => {
    // A blank column reads as a breakage. Saying why is the difference between "no tienes permiso"
    // and "esto está roto".
    const el = await render([]);

    expect(el.querySelector('.menu-empty')?.textContent?.trim()).toBe('SHELL.NO_ENTRIES');
    expect(el.querySelectorAll('a.menu-item').length).toBe(0);
  });
});
