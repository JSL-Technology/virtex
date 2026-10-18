import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { SafeDeleteService, SafeDeleteOptions } from './safe-delete.service';
import { DialogService } from './dialog.service';
import { NotificationService } from './notification';

/** A delete is offered only when it can succeed; otherwise the reader learns why (QA A-08). */
describe('SafeDeleteService', () => {
  let dialog: { confirm: jest.Mock; alert: jest.Mock };
  let notifications: { showSuccess: jest.Mock; showHttpError: jest.Mock };
  let service: SafeDeleteService;

  const words: Record<string, string> = {
    'common.dependents.invoices': 'facturas',
    'common.dependents.invoices_one': 'factura',
    'common.dependents.quotes': 'cotizaciones',
    'common.dependents.quotes_one': 'cotización',
  };

  beforeEach(() => {
    dialog = { confirm: jest.fn().mockResolvedValue(true), alert: jest.fn().mockResolvedValue(undefined) };
    notifications = { showSuccess: jest.fn(), showHttpError: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        SafeDeleteService,
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => words[k] ?? k, currentLang: 'es', getDefaultLang: () => 'es' },
        },
      ],
    });
    service = TestBed.inject(SafeDeleteService);
  });

  const options = (over: Partial<SafeDeleteOptions> = {}): SafeDeleteOptions => ({
    name: 'Ferretería Central',
    check: () => of({ dependents: [] }),
    remove: jest.fn(() => of(undefined)),
    keys: {
      confirmTitle: 't', confirmMessage: 'm', deleted: 'd', deleteFailed: 'f',
      blockedTitle: 'bt', blockedMessage: 'bm', deactivated: 'da',
    },
    ...over,
  });

  it('borra lo que nada usa, tras la confirmación normal', async () => {
    const opts = options();
    expect(await service.run(opts)).toBe('deleted');
    expect(opts.remove).toHaveBeenCalled();
    expect(dialog.confirm.mock.calls[0][0].variant).toBe('danger');
  });

  it('no ofrece borrar lo que usan documentos: nombra cuáles y ofrece desactivar', async () => {
    const deactivate = jest.fn(() => of(undefined));
    const opts = options({
      check: () => of({ dependents: [{ label: 'common.dependents.invoices', count: 2 }, { label: 'common.dependents.quotes', count: 1 }] }),
      deactivate,
    });

    expect(await service.run(opts)).toBe('deactivated');
    expect(opts.remove).not.toHaveBeenCalled();
    expect(dialog.confirm.mock.calls[0][0].messageParams.summary).toBe('2 facturas y 1 cotización');
    expect(deactivate).toHaveBeenCalled();
  });

  it('sin estado inactivo, solo explica (sin un «Cancelar» que no cancela nada)', async () => {
    const opts = options({ check: () => of({ dependents: [{ label: 'common.dependents.invoices', count: 1 }] }) });

    expect(await service.run(opts)).toBe('cancelled');
    expect(dialog.alert).toHaveBeenCalled();
    expect(opts.remove).not.toHaveBeenCalled();
  });

  it('si el borrado falla, enseña el motivo del servidor', async () => {
    const error = new Error('409');
    const opts = options({ remove: () => throwError(() => error) });

    expect(await service.run(opts)).toBe('cancelled');
    expect(notifications.showHttpError).toHaveBeenCalledWith(error, 'f', { name: 'Ferretería Central' });
  });
});
