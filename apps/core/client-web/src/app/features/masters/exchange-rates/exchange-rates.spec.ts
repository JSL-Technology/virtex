import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { ExchangeRatesPage } from './exchange-rates.page';
import { ExchangeRatesService, parseRateTable } from '../data/exchange-rates.service';
import { CurrenciesService } from '../data/currencies.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { AuthService } from '../../../core/services/auth';

describe('parseRateTable', () => {
  it('reads comma, semicolon and tab tables, skips a header, and names the lines it cannot read', () => {
    const { rates, invalidLines } = parseRateTable(
      ['fecha,de,a,tasa', '2026-03-01,usd,DOP,59.10', '2026-03-02;USD;DOP;59,25;official;BCRD', '2026-03-03\tUSD\tDOP\t59.3', 'mal,USD,DOP,1', '2026-03-04,USD,DOP,0'].join('\n'),
    );
    expect(rates).toEqual([
      { date: '2026-03-01', fromCurrency: 'USD', toCurrency: 'DOP', rate: 59.1 },
      { date: '2026-03-02', fromCurrency: 'USD', toCurrency: 'DOP', rate: 59.25, rateType: 'OFFICIAL', source: 'BCRD' },
      { date: '2026-03-03', fromCurrency: 'USD', toCurrency: 'DOP', rate: 59.3 },
    ]);
    expect(invalidLines).toEqual([5, 6]);
  });
});

describe('ExchangeRatesPage', () => {
  let rates: Record<string, jest.Mock>;
  const notifications = { showSuccess: jest.fn(), showError: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'x' };

  function create() {
    rates = {
      history: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 100, pages: 1 })),
      record: jest.fn().mockReturnValue(of({})),
      importRates: jest.fn().mockReturnValue(of({ imported: 1 })),
      remove: jest.fn().mockReturnValue(of(undefined)),
      resolve: jest.fn().mockReturnValue(of({ rate: 59, from: 'USD', to: 'DOP', date: '2026-03-01', rateType: 'OFFICIAL', method: 'DIRECT', source: 'BCRD', quotedOn: '2026-03-01' })),
    };
    TestBed.configureTestingModule({
      imports: [ExchangeRatesPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: ExchangeRatesService, useValue: rates },
        { provide: CurrenciesService, useValue: { getCurrencies: () => of([{ id: '1', code: 'USD', name: 'Dólar' }, { id: '2', code: 'DOP', name: 'Peso' }]) } },
        { provide: LocaleStore, useValue: { currency: () => 'DOP' } },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: { confirm: jest.fn().mockResolvedValue(true) } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['exchange_rates:manage']), hasPermissions: () => true } },
      ],
    });
    const fixture = TestBed.createComponent(ExchangeRatesPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('records a rate into the base currency by default', () => {
    const page = create();
    expect(page.form.value.toCurrency).toBe('DOP');
    page.form.patchValue({ fromCurrency: 'USD', rate: 59.1, date: '2026-03-01', source: ' bcrd ' });
    page.save();
    expect(rates['record']).toHaveBeenCalledWith({ fromCurrency: 'USD', toCurrency: 'DOP', date: '2026-03-01', rate: 59.1, rateType: 'OFFICIAL', source: 'bcrd' });
  });

  it('refuses the same currency on both sides', () => {
    const page = create();
    page.form.patchValue({ fromCurrency: 'DOP', rate: 1 });
    page.save();
    expect(rates['record']).not.toHaveBeenCalled();
  });

  it('imports only a table with no unreadable lines', () => {
    const page = create();
    page.importText.set('2026-03-01,USD,DOP,59\nmal');
    page.confirmImport();
    expect(rates['importRates']).not.toHaveBeenCalled();
    page.importText.set('2026-03-01,USD,DOP,59');
    page.confirmImport();
    expect(rates['importRates']).toHaveBeenCalledWith([{ date: '2026-03-01', fromCurrency: 'USD', toCurrency: 'DOP', rate: 59 }]);
  });

  it('removes only the company\'s own rates', async () => {
    const page = create();
    await page.remove({ id: 's', scope: 'SHARED', fromCurrency: 'USD', toCurrency: 'DOP', rate: 1, date: '2026-03-01', rateType: 'OFFICIAL', source: 'XE', recordedByUserId: null });
    expect(rates['remove']).not.toHaveBeenCalled();
    await page.remove({ id: 't', scope: 'TENANT', fromCurrency: 'USD', toCurrency: 'DOP', rate: 1, date: '2026-03-01', rateType: 'OFFICIAL', source: 'MANUAL', recordedByUserId: null });
    expect(rates['remove']).toHaveBeenCalledWith('t');
  });
});
