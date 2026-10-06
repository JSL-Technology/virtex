import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { environment } from '../../../../environments/environment';
import { BanksPage } from './banks.page';

/**
 * «Bancos» was deduced from the names typed into bank accounts. It reads the catalogue now, and a
 * bank no account is held at can be removed from it.
 */
describe('BanksPage', () => {
  const API = `${environment.apiUrl}/treasury/banks`;
  const dialog = { confirm: jest.fn() };
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: jest.fn(() => 'x') };
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
      imports: [BanksPage, TranslateModule.forRoot()],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(BanksPage);
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
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
});
