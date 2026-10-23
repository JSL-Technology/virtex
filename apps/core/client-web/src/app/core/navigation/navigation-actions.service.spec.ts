import { TestBed } from '@angular/core/testing';
import { Clipboard } from '@angular/cdk/clipboard';

import { NavigationActionsService } from './navigation-actions.service';
import { TabStateService } from '../tabs/tab-state.service';
import { TabCommandsService } from '../tabs/tab-command.service';
import { ActiveOrganizationService } from '../tenancy/active-organization.service';
import { NotificationService } from '../services/notification';

/**
 * The five ways of opening a menu destination, shared by the panel, the favourites and the tab
 * strip. Each must reach the workspace with the route as the workspace names it — no company —
 * and each link must carry the company, or it opens in whichever one the reader used last.
 */
describe('NavigationActionsService', () => {
  const tabs = { openTab: jest.fn() };
  const commands = { run: jest.fn() };
  const clipboard = { copy: jest.fn() };
  const notify = { showInfo: jest.fn(), showSuccess: jest.fn(), showError: jest.fn() };
  let service: NavigationActionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        { provide: TabStateService, useValue: tabs },
        { provide: TabCommandsService, useValue: commands },
        { provide: Clipboard, useValue: clipboard },
        { provide: NotificationService, useValue: notify },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => `/e/acme${path}` } },
      ],
    });
    service = TestBed.inject(NavigationActionsService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('vista previa: la decide el área de trabajo según la preferencia', () => {
    service.open('/e/acme/accounting/journals', 'preview');
    expect(tabs.openTab).toHaveBeenCalledWith({ route: '/accounting/journals', queryParams: undefined });
  });

  it('pestaña nueva: permanente', () => {
    service.open('/accounting/journals', 'permanent');
    expect(tabs.openTab).toHaveBeenCalledWith({ route: '/accounting/journals', queryParams: undefined, preview: false });
  });

  it('segundo plano: permanente, sin quitar de delante la ventana actual, y lo dice', () => {
    service.open('/accounting/journals', 'background');
    expect(tabs.openTab).toHaveBeenCalledWith({
      route: '/accounting/journals', queryParams: undefined, preview: false, activate: false,
    });
    expect(notify.showInfo).toHaveBeenCalledWith('shell.nav.opened_in_background');
  });

  it('al lado: abre y, ya dibujada, la divide a la derecha', () => {
    service.open('/accounting/journals', 'side');
    expect(tabs.openTab).toHaveBeenCalledWith({ route: '/accounting/journals', queryParams: undefined, preview: false });
    TestBed.tick();
    expect(commands.run).toHaveBeenCalledWith('layout.split_right');
  });

  it('ventana nueva: el enlace completo, sin dar acceso a esta ventana (noopener)', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    service.open('/accounting/journals?status=open', 'window');
    expect(open).toHaveBeenCalledWith(
      `${location.origin}/e/acme/accounting/journals?status=open`, '_blank', 'noopener,noreferrer',
    );
    open.mockRestore();
  });

  it('copiar enlace: con la empresa y la consulta, y confirma', () => {
    clipboard.copy.mockReturnValue(true);
    service.copyLink('/e/acme/invoices?status=overdue');
    expect(clipboard.copy).toHaveBeenCalledWith(`${location.origin}/e/acme/invoices?status=overdue`);
    expect(notify.showSuccess).toHaveBeenCalledWith('shell.nav.link_copied');
  });

  it('si el portapapeles no deja, lo dice y sugiere la barra de direcciones', () => {
    clipboard.copy.mockReturnValue(false);
    service.copyLink('/invoices');
    expect(notify.showError).toHaveBeenCalledWith('shell.nav.link_copy_failed');
  });
});
