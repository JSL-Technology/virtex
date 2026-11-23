import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { of } from 'rxjs';
import { TranslateModule, LocaleStore } from '@virtex/shared/ui-i18n';
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

  type Source = { country: string; publisher: string; quoteCurrency: string; legalBasis: string; feed: unknown };
  const dominican = (feed: unknown): Source => ({
    country: 'DO',
    publisher: 'Banco Central de la República Dominicana',
    quoteCurrency: 'DOP',
    legalBasis: 'Tasa de cambio de referencia del Banco Central.',
    feed,
  });

  function create(sources: Source[] = [dominican(null)]) {
    rates = {
      officialSources: jest.fn().mockReturnValue(of(sources)),
      history: jest.fn().mockReturnValue(of({ items: [], total: 0, page: 1, limit: 100, pages: 1 })),
      record: jest.fn().mockReturnValue(of({})),
      importRates: jest.fn().mockReturnValue(of({ imported: 1 })),
      remove: jest.fn().mockReturnValue(of(undefined)),
      resolve: jest.fn().mockReturnValue(of({ rate: 59, from: 'USD', to: 'DOP', date: '2026-03-01', rateType: 'OFFICIAL', method: 'DIRECT', source: 'BCRD', quotedOn: '2026-03-01' })),
    };
    TestBed.configureTestingModule({
      imports: [ExchangeRatesPage],
      providers: [
        provideRouter([]),
        { provide: ExchangeRatesService, useValue: rates },
        { provide: CurrenciesService, useValue: { getCurrencies: () => of([{ id: '1', code: 'USD', name: 'Dólar' }, { id: '2', code: 'DOP', name: 'Peso' }]) } },
        { provide: LocaleStore, useValue: { currency: () => 'DOP', locale: () => 'es-DO', timezone: () => 'America/Santo_Domingo', regionalFormat: () => ({}) } },
        { provide: NotificationService, useValue: notifications },
        { provide: DialogService, useValue: { confirm: jest.fn().mockResolvedValue(true) } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['exchange_rates:manage']), hasPermissions: () => true } },
      ],
    });
    fixture = TestBed.createComponent(ExchangeRatesPage);
    fixture.detectChanges();
    return fixture.componentInstance;
  }
  let fixture: ReturnType<typeof TestBed.createComponent<ExchangeRatesPage>>;

  /**
   * Where the company's official rate comes from, and whether it has to enter it (FINB-03): the
   * source quoted in its currency, in one of three states.
   */
  describe('the official source of the company\'s rates', () => {
    it('says the publisher\'s rate is entered here when the product does not read it', () => {
      const page = create([dominican(null)]);
      expect(page.officialSource()?.publisher).toBe('Banco Central de la República Dominicana');
      expect(page.officialSourceState()).toBe('manual');
      expect(fixture.nativeElement.querySelector('.official-source')).not.toBeNull();
    });

    it('says it arrives on its own once the feed is active', () => {
      const page = create([dominican({ code: 'DO-X', publication: 'Tasa de referencia', status: 'ACTIVE', latestEffectiveOn: '2026-03-17' })]);
      expect(page.officialSourceState()).toBe('automatic');
    });

    it('and that it does not yet while the feed is in shadow', () => {
      const page = create([dominican({ code: 'DO-X', publication: 'Tasa de referencia', status: 'SHADOW', latestEffectiveOn: null })]);
      expect(page.officialSourceState()).toBe('not_active');
    });

    it('shows nothing for a currency no market publishes an official rate for', () => {
      const page = create([{ ...dominican(null), quoteCurrency: 'COP', country: 'CO' }]);
      expect(page.officialSource()).toBeNull();
      expect(fixture.nativeElement.querySelector('.official-source')).toBeNull();
    });
  });

  it('says when the rate a document would use is the market one, for want of an official one (FINB-06)', () => {
    const page = create();
    rates['resolve'].mockReturnValue(
      of({ rate: 0.39, from: 'JPY', to: 'DOP', date: '2026-01-08', rateType: 'MARKET', method: 'DIRECT', source: 'XE', quotedOn: '2026-01-06', substitutedFor: 'OFFICIAL' }),
    );
    page.lookup.patchValue({ from: 'JPY', to: 'DOP', date: '2026-01-08' });
    page.resolve();
    fixture.detectChanges();
    expect(page.resolved()?.substitutedFor).toBe('OFFICIAL');
    expect(fixture.nativeElement.querySelector('.lookup-result strong')).not.toBeNull();
  });

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
