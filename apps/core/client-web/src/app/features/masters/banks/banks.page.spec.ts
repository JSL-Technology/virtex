import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth';
import { of } from 'rxjs';
import { BanksPage } from './banks.page';

/**
 * «Bancos» was deduced from the names typed into bank accounts. It reads the catalogue now, and a
 * bank no account is held at can be removed from it.
 */
describe('BanksPage', () => {
  const API = `${environment.apiUrl}/treasury/banks`;
  const dialog = { confirm: jest.fn() };
  const notifications = {
    showSuccess: jest.fn(),
    showInfo: jest.fn(),
    showHttpError: jest.fn(),
    httpErrorMessage: jest.fn(() => 'x'),
  };
  const auth = { isAuthenticated$: of(true), getPermissions$: () => of([]), hasPermissions: jest.fn(() => true) };
  const REFERENCE = `${API}/reference`;
  const noReference = { country: null, available: 0, missing: 0 };
  let http: HttpTestingController;

  const bank = (over: Record<string, unknown> = {}) => ({
    id: 'b-1',
    name: 'Banco Popular Dominicano',
    swiftBic: 'BPDODOSX',
    countryCode: 'DO',
    localCode: null,
    isActive: true,
    accountCount: 0,
    ...over,
  });

  function create() {
    TestBed.configureTestingModule({
      imports: [BanksPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(BanksPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    // Every load also asks whether there is an official list to offer; these tests do not care.
    http.match(REFERENCE).forEach((request) => request.flush(noReference));
    http.verify();
    jest.clearAllMocks();
  });

  it('lists the catalogue, not names deduced from the accounts', () => {
    const fixture = create();
    http.expectOne(API).flush([bank(), bank({ id: 'b-2', name: 'Banreservas', accountCount: 2 })]);
    fixture.detectChanges();

    expect(fixture.componentInstance.banks().map((b) => b.name)).toEqual(['Banco Popular Dominicano', 'Banreservas']);
  });

  it('deletes a bank after confirming, and reloads', async () => {
    const fixture = create();
    http.expectOne(API).flush([bank()]);
    dialog.confirm.mockResolvedValue(true);

    await fixture.componentInstance.remove(bank() as never);

    http.expectOne((r) => r.url === `${API}/b-1` && r.method === 'DELETE').flush(null);
    http.expectOne(API).flush([]);
    expect(notifications.showSuccess).toHaveBeenCalled();
  });

  it('reports the server refusing a bank still in use', async () => {
    const fixture = create();
    http.expectOne(API).flush([bank()]);
    dialog.confirm.mockResolvedValue(true);

    await fixture.componentInstance.remove(bank() as never);

    http
      .expectOne((r) => r.url === `${API}/b-1` && r.method === 'DELETE')
      .flush({ messageKey: 'treasury.bank_in_use' }, { status: 409, statusText: 'Conflict' });
    expect(notifications.showHttpError).toHaveBeenCalled();
  });

  describe('official list of the company\'s country', () => {
    const button = (fixture: ReturnType<typeof create>) =>
      fixture.nativeElement.querySelector('[data-testid=banks-import-reference-empty]') as HTMLButtonElement | null;

    it('offers, in the empty catalogue, to add the institutions the list holds', () => {
      const fixture = create();
      http.expectOne(REFERENCE).flush({ country: 'DO', available: 43, missing: 43 });
      http.expectOne(API).flush([]);
      fixture.detectChanges();

      expect(fixture.componentInstance.canImport()).toBe(true);
      expect(button(fixture)).not.toBeNull();
    });

    it('does not offer it where no list is shipped, or when nothing is missing', () => {
      const fixture = create();
      http.expectOne(REFERENCE).flush(noReference);
      http.expectOne(API).flush([]);
      fixture.detectChanges();
      expect(button(fixture)).toBeNull();

      fixture.componentInstance.load();
      http.expectOne(REFERENCE).flush({ country: 'DO', available: 43, missing: 0 });
      http.expectOne(API).flush([bank()]);
      fixture.detectChanges();
      expect(fixture.componentInstance.canImport()).toBe(false);
    });

    it('imports, says how many were added, and reloads the catalogue', () => {
      const fixture = create();
      http.expectOne(REFERENCE).flush({ country: 'DO', available: 43, missing: 40 });
      http.expectOne(API).flush([bank()]);

      fixture.componentInstance.importReference();
      // A second click while the first is running sends nothing.
      fixture.componentInstance.importReference();
      http.expectOne((r) => r.url === `${API}/reference-import` && r.method === 'POST').flush({ country: 'DO', added: 40, skipped: 3 });

      expect(notifications.showSuccess).toHaveBeenCalledWith('masters.banks.reference_imported', expect.objectContaining({ count: 40 }));
      http.expectOne(REFERENCE).flush({ country: 'DO', available: 43, missing: 0 });
      http.expectOne(API).flush([bank()]);
    });

    it('says the catalogue is complete when there was nothing to add', () => {
      const fixture = create();
      http.expectOne(REFERENCE).flush({ country: 'DO', available: 43, missing: 1 });
      http.expectOne(API).flush([]);

      fixture.componentInstance.importReference();
      http.expectOne(`${API}/reference-import`).flush({ country: 'DO', added: 0, skipped: 43 });
      expect(notifications.showInfo).toHaveBeenCalledWith('masters.banks.reference_up_to_date');
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      http.expectOne(API).flush([]);
    });

    it('reports a refused import', () => {
      const fixture = create();
      http.expectOne(REFERENCE).flush({ country: 'DO', available: 43, missing: 43 });
      http.expectOne(API).flush([]);

      fixture.componentInstance.importReference();
      http.expectOne(`${API}/reference-import`).flush({ messageKey: 'auth.forbidden' }, { status: 403, statusText: 'Forbidden' });
      expect(notifications.showHttpError).toHaveBeenCalledWith(expect.anything(), 'masters.banks.reference_import_failed');
      expect(fixture.componentInstance.importing()).toBe(false);
    });
  });
});
