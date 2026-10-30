import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { useCatalogue } from '../../../../../testing/api-errors';
import { SettingsShellService } from '../../shell';
import { SequenceSettingsPage } from './sequences.page';

/** CG-15 / CG-19: one save for the numbering, said before it is done; CG-17: no «retry» on a 403. */
describe('SequenceSettingsPage', () => {
  let http: HttpTestingController;
  const dialog = { confirm: jest.fn() };
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'No tienes permiso') };
  const rows = [
    { id: '1', type: 'INVOICE', prefix: 'FAC-', nextNumber: 10, nextFormatted: 'FAC-00000010' },
    { id: '2', type: 'QUOTE', prefix: 'COT-', nextNumber: 3, nextFormatted: 'COT-00000003' },
  ];

  function create() {
    TestBed.configureTestingModule({
      imports: [SequenceSettingsPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        SettingsShellService,
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
      ],
    });
    useCatalogue({});
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SequenceSettingsPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('saves every changed row at once, after confirming, and tells the shell there is unsaved work', async () => {
    const fixture = create();
    const page = fixture.componentInstance;
    http.expectOne((r) => r.url.endsWith('/document-sequences')).flush(rows);
    const shell = TestBed.inject(SettingsShellService);

    page.edit(rows[0], { prefix: 'F-' });
    page.edit(rows[1], { nextNumber: 9 });
    expect(shell.dirty()).toBe(true);

    dialog.confirm.mockResolvedValueOnce(true);
    const saving = page.saveAll();
    await Promise.resolve();
    await Promise.resolve();
    const requests = http.match((r) => r.method === 'PATCH');
    expect(requests.map((r) => r.request.body)).toEqual([{ prefix: 'F-' }, { nextNumber: 9 }]);
    expect(dialog.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'settings.sequences.confirm_message_gap' }));
    requests[0].flush({ ...rows[0], prefix: 'F-', nextFormatted: 'F-00000010' });
    requests[1].flush({ ...rows[1], nextNumber: 9, nextFormatted: 'COT-00000009' });
    await expect(saving).resolves.toBe(true);
    expect(shell.dirty()).toBe(false);
  });

  it('sends nothing when the confirmation is declined, and keeps the edits', async () => {
    const page = create().componentInstance;
    http.expectOne((r) => r.url.endsWith('/document-sequences')).flush(rows);
    page.edit(rows[0], { prefix: 'F-' });
    dialog.confirm.mockResolvedValueOnce(false);
    await expect(page.saveAll()).resolves.toBe(false);
    http.expectNone((r) => r.method === 'PATCH');
    expect(page.dirty()).toBe(true);
  });

  it('refuses a number that goes back, without asking', async () => {
    const page = create().componentInstance;
    http.expectOne((r) => r.url.endsWith('/document-sequences')).flush(rows);
    page.edit(rows[0], { nextNumber: 2 });
    expect(page.invalid()).toBe(true);
    await expect(page.saveAll()).resolves.toBe(false);
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('offers no «retry» when the server refuses to show the numbering', () => {
    const fixture = create();
    http.expectOne((r) => r.url.endsWith('/document-sequences')).flush({ statusCode: 403 }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(fixture.componentInstance.forbidden()).toBe(true);
    expect(element.querySelector('.seq__state--error button')).toBeNull();
  });

  it('is read only without the permission', () => {
    const fixture = create();
    TestBed.inject(SettingsShellService).canEdit.set(false);
    http.expectOne((r) => r.url.endsWith('/document-sequences')).flush(rows);
    fixture.detectChanges();
    const inputs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('input')];
    expect(inputs.length).toBe(4);
    expect(inputs.every((input) => input.disabled)).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('vx-settings-save-bar')).toBeNull();
  });
});
