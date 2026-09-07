import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ModuleMenuComponent } from './module-menu.component';
import { PanelSection } from '../../core/modules/active-module.service';
import { GROUP_LABEL } from '../../core/modules/menu-labels';
import { moduleIcon } from '../../core/modules/module-icons';

/**
 * The top-bar shell's mega-menu.
 *
 * `layoutStyle` defaults to `topnav`, so this is what most tenants see. Before it existed, choosing
 * the top bar made every module offer exactly one destination and hid the rest behind a URL — the
 * tests here are about that not happening again.
 */
describe('ModuleMenuComponent', () => {
  let fixture: ComponentFixture<ModuleMenuComponent>;

  const entry = (path: string) => ({ path, labelKey: `X.${path}`, icon: moduleIcon('FileText') });

  const sections: PanelSection[] = [
    { group: 'inbox', labelKey: GROUP_LABEL.inbox, entries: [entry('/my-work')] },
    {
      group: 'documents',
      labelKey: GROUP_LABEL.documents,
      entries: [entry('/invoices'), entry('/invoices/pending')],
    },
    { group: 'masters', labelKey: GROUP_LABEL.masters, entries: [entry('/customers')] },
  ];

  async function render(activeEntry: string | null = null) {
    await TestBed.configureTestingModule({
      imports: [ModuleMenuComponent, TranslateModule.forRoot()],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ModuleMenuComponent);
    fixture.componentRef.setInput('sections', sections);
    fixture.componentRef.setInput('activeEntry', activeEntry);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('da una columna por grupo, en el orden recibido', async () => {
    const el = await render();

    const titles = [...el.querySelectorAll('.mm__group')].map((h) => h.textContent?.trim());
    expect(titles).toEqual(['SHELL.GROUP_INBOX', 'SHELL.GROUP_DOCUMENTS', 'SHELL.GROUP_MASTERS']);
  });

  it('ofrece todos los destinos del módulo, no solo el primero', async () => {
    // The whole reason this component exists: the top bar used to reach one screen per module.
    const el = await render();

    const paths = [...el.querySelectorAll('a.mm__entry')].map((a) => a.getAttribute('href'));
    expect(paths).toEqual(['/my-work', '/invoices', '/invoices/pending', '/customers']);
  });

  it('marca la entrada activa', async () => {
    const el = await render('/invoices');

    const activos = [...el.querySelectorAll('.mm__entry--active')];
    expect(activos.length).toBe(1);
    expect(activos[0].getAttribute('aria-current')).toBe('page');
  });

  it('avisa al elegir un destino para que el armazón cierre el menú', async () => {
    const el = await render();
    const chosen = jest.fn();
    fixture.componentInstance.chosen.subscribe(chosen);

    (el.querySelector('a.mm__entry') as HTMLAnchorElement).click();

    expect(chosen).toHaveBeenCalledWith('/my-work');
  });
});
