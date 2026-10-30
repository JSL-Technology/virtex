import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { UsersService } from '../data/users.service';
import { SettingsShellService } from '../shell';
import { RegionalFormatPage } from './regional-format.page';
import { useCatalogue } from '../../../../testing/api-errors';

/** «¿El usuario puede configurar el formato de fechas y los separadores decimales?» — now, yes: both levels. */
describe('RegionalFormatPage', () => {
  let http: HttpTestingController;
  const dialog = { confirm: jest.fn() };
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn() };
  const users = { updateProfile: jest.fn(() => of({})) };

  function create(view: 'company' | 'personal') {
    TestBed.configureTestingModule({
      imports: [RegionalFormatPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService(),
        SettingsShellService,
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
        { provide: UsersService, useValue: users },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    useCatalogue({ 'settings.regional_format.automatic': 'Automático · {{example}}' });
    const store = TestBed.inject(LocaleStore);
    store.setLanguage('es');
    store.setTenantContext({
      language: 'es', locale: 'es-DO', direction: 'ltr', countryCode: 'DO', currency: 'DOP',
      timezone: 'America/Santo_Domingo', booksLanguage: 'es', firstDayOfWeek: 0, companyFormat: { numberFormat: 'dot_comma' },
    });
    const fixture = TestBed.createComponent(RegionalFormatPage);
    fixture.componentRef.setInput('view', view);
    fixture.detectChanges();
    return { fixture, store, shell: TestBed.inject(SettingsShellService) };
  }

  afterEach(() => {
    http.verify();
    jest.clearAllMocks();
  });

  it('saves the company default for everyone only after confirming, and applies it at once', async () => {
    const { fixture, store, shell } = create('company');
    http.expectOne((r) => r.url.endsWith('/organizations/regional-format')).flush({ numberFormat: 'dot_comma' });
    const page = fixture.componentInstance as unknown as { draft: { set(v: object): void }; saveCompany(): Promise<boolean> };

    page.draft.set({ numberFormat: 'dot_comma', dateOrder: 'YMD' });
    expect(shell.dirty()).toBe(true);

    dialog.confirm.mockResolvedValueOnce(false);
    await expect(page.saveCompany()).resolves.toBe(false);
    http.expectNone((r) => r.method === 'PUT');

    dialog.confirm.mockResolvedValueOnce(true);
    const saving = page.saveCompany();
    await Promise.resolve();
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toEqual({ numberFormat: 'dot_comma', dateOrder: 'YMD' });
    put.flush({ numberFormat: 'dot_comma', dateOrder: 'YMD' });
    await expect(saving).resolves.toBe(true);
    expect(store.companyFormat()).toEqual({ numberFormat: 'dot_comma', dateOrder: 'YMD' });
    expect(shell.dirty()).toBe(false);
  });

  it('offers the editor read-only without the permission', () => {
    const { fixture, shell } = create('company');
    shell.canEdit.set(false);
    http.expectOne((r) => r.url.endsWith('/organizations/regional-format')).flush({});
    fixture.detectChanges();
    const selects = [...(fixture.nativeElement as HTMLElement).querySelectorAll('select')];
    expect(selects.length).toBe(5);
    expect(selects.every((select) => select.disabled)).toBe(true);
    expect((fixture.nativeElement as HTMLElement).querySelector('vx-settings-save-bar')).toBeNull();
  });

  it('saves a person’s own choice as it is made, over the company’s, and says it autosaves', () => {
    const { fixture, store, shell } = create('personal');
    expect(shell.autosaves()).toBe(true);
    const select = (fixture.nativeElement as HTMLElement).querySelectorAll('select')[0] as HTMLSelectElement;
    select.value = 'MDY';
    select.dispatchEvent(new Event('change'));
    expect(users.updateProfile).toHaveBeenCalledWith({ regionalFormat: { dateOrder: 'MDY' } });
    expect(store.regionalFormat()).toEqual({ dateOrder: 'MDY', numberFormat: 'dot_comma' });
    expect(shell.autosavedAt()).not.toBeNull();
  });

  it('shows what «automatic» means at each level, with an example', () => {
    const { fixture } = create('personal');
    const numberSelect = (fixture.nativeElement as HTMLElement).querySelectorAll('select')[2] as HTMLSelectElement;
    // For the person, automatic is the company's decimal comma.
    expect(numberSelect.options[0].textContent).toContain('1.234.567,89');
  });
});
