import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { VendorPaymentPage } from './payment.page';
import { environment } from '../../../../environments/environment';

/**
 * Nothing could pay a supplier invoice. The assertions that matter: only bills the chosen account
 * can actually settle are offered — the server refuses a USD bill paid from a EUR account, because
 * that needs a rate nobody has stated — and withholding settles the bill without cash leaving.
 */
describe('VendorPaymentPage', () => {
  let fixture: ComponentFixture<VendorPaymentPage>;
  let component: VendorPaymentPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const account = (id: string, currencyCode: string) => ({
    id,
    name: `Cuenta ${currencyCode}`,
    bankName: null,
    accountNumber: null,
    iban: null,
    swiftBic: null,
    accountType: 'CHECKING' as const,
    currencyCode,
    glAccountId: `gl-${id}`,
    openingBalance: 0,
    openingDate: null,
    isActive: true,
    notes: null,
  });

  const bills = [
    {
      id: 'v1',
      vendorId: 's1',
      vendorName: 'Suplidora del Caribe',
      billNumber: 'B-001',
      issueDate: '2026-03-01',
      dueDate: '2026-04-01',
      currencyCode: 'DOP',
      total: 11_800,
      balance: 11_800,
      status: 'OPEN' as const,
    },
    {
      id: 'v2',
      vendorId: 's2',
      vendorName: 'Licencias SA',
      billNumber: 'B-002',
      issueDate: '2026-03-01',
      dueDate: '2026-04-01',
      currencyCode: 'EUR',
      total: 500,
      balance: 500,
      status: 'OPEN' as const,
    },
    {
      id: 'v3',
      vendorId: 's3',
      vendorName: 'Pagada ya',
      billNumber: 'B-003',
      issueDate: '2026-03-01',
      dueDate: '2026-04-01',
      currencyCode: 'DOP',
      total: 100,
      balance: 0,
      status: 'PAID' as const,
    },
  ];

  const boot = (accounts = [account('b1', 'DOP'), account('b2', 'USD')], baseCurrency = 'DOP') => {
    fixture.detectChanges();
    httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts`).flush(accounts);
    httpMock.expectOne((c) => c.url === `${API}/accounts-payable`).flush(bills);
    httpMock
      .expectOne((c) => c.url === `${API}/treasury/cash-position`)
      .flush({ asOfDate: '2026-03-31', baseCurrency, accounts: [], total: 0 });
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VendorPaymentPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(VendorPaymentPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
  });

  it('offers every open bill from an account in the books’ currency', () => {
    boot();
    // The DOP account is the books' currency, so a EUR bill is measurable at the day's rate.
    expect(component.payableBills().map((b) => b.id)).toEqual(['v1', 'v2']);
    httpMock.verify();
  });

  it('offers only its own currency from an account that is not the books’ one', () => {
    boot();
    component.onBankAccountChange('b2');
    fixture.detectChanges();

    // A USD account paying a DOP or EUR bill needs a rate nobody stated; the server refuses it.
    expect(component.payableBills()).toEqual([]);
    httpMock.verify();
  });

  it('never offers a bill that owes nothing', () => {
    boot();
    expect(component.payableBills().some((b) => b.id === 'v3')).toBe(false);
    httpMock.verify();
  });

  it('counts withholding as settling the bill, not as cash leaving', () => {
    boot();
    component.addBill(component.payableBills()[0]);
    component.lines.at(0).patchValue({ amount: 10_000, taxWithheld: 1_800 });

    expect(component.settledBy(component.lines.at(0).value)).toBe(11_800);
    expect(component.totals().cash).toBe(10_000);
    expect(component.totals().withheld).toBe(1_800);
    expect(component.exceedsBalance(component.lines.at(0).value)).toBe(false);
    httpMock.verify();
  });

  it('refuses a line that settles more than the bill owes', () => {
    boot();
    component.addBill(component.payableBills()[0]);
    component.lines.at(0).patchValue({ amount: 11_800, discount: 500 });

    expect(component.exceedsBalance(component.lines.at(0).value)).toBe(true);
    component.save();
    httpMock.expectNone((c) => c.url === `${API}/accounts-payable/payments`);
    httpMock.verify();
  });

  it('posts the batch with its lines', () => {
    boot();
    component.addBill(component.payableBills()[0]);
    component.lines.at(0).patchValue({ amount: 10_000, taxWithheld: 1_800 });
    component.save();

    const request = httpMock.expectOne((c) => c.url === `${API}/accounts-payable/payments`);
    expect(request.request.body).toMatchObject({ bankAccountId: 'b1' });
    expect(request.request.body.lines[0]).toMatchObject({
      vendorBillId: 'v1',
      amount: 10_000,
      taxWithheld: 1_800,
    });
    request.flush({ id: 'batch1' });
    httpMock.verify();
  });
});
