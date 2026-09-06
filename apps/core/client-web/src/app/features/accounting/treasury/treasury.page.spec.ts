import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { TreasuryPage } from './treasury.page';
import { CashPosition } from '../../../core/api/treasury.service';
import { environment } from '../../../../environments/environment';

/**
 * There was no way to ask how much the company had. The two assertions worth making are that the
 * account number never arrives in full, and that a control account shared by two bank accounts is
 * counted once — which is right, and is why the page says so rather than leaving the reader to
 * wonder why the rows do not add up to the total.
 */
describe('TreasuryPage', () => {
  let fixture: ComponentFixture<TreasuryPage>;
  let component: TreasuryPage;
  let httpMock: HttpTestingController;

  const position: CashPosition = {
    asOfDate: '2026-03-31',
    baseCurrency: 'DOP',
    accounts: [
      {
        bankAccountId: 'b1',
        name: 'Popular corriente',
        bankName: 'Banco Popular',
        accountNumberMasked: '••••4567',
        currencyCode: 'DOP',
        glAccountId: 'gl1',
        balanceInBaseCurrency: 250_000,
        balanceInAccountCurrency: 250_000,
        currencyBalanceUnavailable: null,
      },
      {
        bankAccountId: 'b2',
        name: 'Popular ahorros',
        bankName: 'Banco Popular',
        accountNumberMasked: '••••9999',
        currencyCode: 'DOP',
        glAccountId: 'gl1',
        balanceInBaseCurrency: 250_000,
        balanceInAccountCurrency: 250_000,
        currencyBalanceUnavailable: null,
      },
    ],
    total: 250_000,
  };

  /** A dollar account whose postings carry the dollar amount, and one whose postings do not. */
  const foreignPosition: CashPosition = {
    asOfDate: '2026-03-31',
    baseCurrency: 'DOP',
    accounts: [
      {
        bankAccountId: 'b3',
        name: 'Reservas USD',
        bankName: 'Banco de Reservas',
        accountNumberMasked: '••••0001',
        currencyCode: 'USD',
        glAccountId: 'gl2',
        balanceInBaseCurrency: 58_162.5,
        balanceInAccountCurrency: 990,
        currencyBalanceUnavailable: null,
      },
      {
        bankAccountId: 'b4',
        name: 'Reservas USD antigua',
        bankName: 'Banco de Reservas',
        accountNumberMasked: '••••0002',
        currencyCode: 'USD',
        glAccountId: 'gl3',
        balanceInBaseCurrency: 58_750,
        balanceInAccountCurrency: null,
        currencyBalanceUnavailable: 'NOT_RECORDED',
      },
    ],
    total: 116_912.5,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TreasuryPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(TreasuryPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  const flushAll = (body: CashPosition = position) => {
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/treasury/cash-position`)
      .flush(body);
    httpMock.expectOne((c) => c.url === `${environment.apiUrl}/treasury/bank-accounts`).flush([]);
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/treasury/bank-transfers`)
      .flush({ rows: [], page: 1, pageSize: 25, total: 0, hasMore: false });
    fixture.detectChanges();
  };

  it('shows only the masked account number', () => {
    fixture.detectChanges();
    flushAll();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('••••4567');
    expect(text).not.toMatch(/\d{6,}/);
    httpMock.verify();
  });

  it('warns that a shared control account is counted once', () => {
    fixture.detectChanges();
    flushAll();

    // Two rows of 250,000 against a total of 250,000: correct, and surprising without the note.
    expect(component.hasSharedControlAccount()).toBe(true);
    expect(fixture.nativeElement.querySelector('.note')).toBeTruthy();
    httpMock.verify();
  });

  it('says nothing about sharing when no two accounts share one', () => {
    fixture.detectChanges();
    flushAll({
      ...position,
      accounts: [position.accounts[0], { ...position.accounts[1], glAccountId: 'gl2' }],
      total: 500_000,
    });

    expect(component.hasSharedControlAccount()).toBe(false);
    expect(fixture.nativeElement.querySelector('.note')).toBeFalsy();
    httpMock.verify();
  });

  /**
   * The row used to state the account's currency beside a figure measured in the BOOKS' currency,
   * and offer nothing else — so this table showed `USD` next to 58,162.50 for an account holding
   * 990 dollars.
   */
  it('shows a foreign account’s balance in its own currency', () => {
    fixture.detectChanges();
    flushAll(foreignPosition);

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('990');
    expect(text).toContain('58,162.50');
  });

  it('shows a dash, not a made-up figure, when the currency balance was never recorded', () => {
    fixture.detectChanges();
    flushAll(foreignPosition);

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    // Second row: the balance in its own currency cannot be derived, so it is left as a dash.
    const cells = rows[1].querySelectorAll('td');
    expect((cells[4].textContent as string).trim()).toBe('—');
    expect((cells[5].textContent as string).trim()).toContain('58,750');
  });

  it('re-asks when the cut-off date changes', () => {
    fixture.detectChanges();
    flushAll();

    component.onDateChange('2026-02-28');
    const request = httpMock.expectOne(
      (c) => c.url === `${environment.apiUrl}/treasury/cash-position`,
    );
    expect(request.request.params.get('asOfDate')).toBe('2026-02-28');
    request.flush(position);
    httpMock.expectOne((c) => c.url === `${environment.apiUrl}/treasury/bank-accounts`).flush([]);
    httpMock
      .expectOne((c) => c.url === `${environment.apiUrl}/treasury/bank-transfers`)
      .flush({ rows: [], page: 1, pageSize: 25, total: 0, hasMore: false });
    httpMock.verify();
  });
});
