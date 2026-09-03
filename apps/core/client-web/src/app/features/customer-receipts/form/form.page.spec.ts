import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CustomerReceiptFormPage } from './form.page';
import { environment } from '../../../../environments/environment';

/**
 * The page it replaces had four fields and a save method whose body was a `console.log` saying the
 * feature was not connected. What matters now: it posts, it carries the withholdings that settle a
 * receivable without cash arriving, and the currency follows the account rather than the user —
 * the server refuses a receipt whose currency the account cannot receive.
 */
describe('CustomerReceiptFormPage', () => {
  let fixture: ComponentFixture<CustomerReceiptFormPage>;
  let component: CustomerReceiptFormPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const bankAccounts = [
    {
      id: 'b1',
      name: 'Popular corriente',
      bankName: null,
      accountNumber: null,
      iban: null,
      swiftBic: null,
      accountType: 'CHECKING' as const,
      currencyCode: 'DOP',
      glAccountId: 'gl1',
      openingBalance: 0,
      openingDate: null,
      isActive: true,
      notes: null,
    },
    {
      id: 'b2',
      name: 'Reservas USD',
      bankName: null,
      accountNumber: null,
      iban: null,
      swiftBic: null,
      accountType: 'SAVINGS' as const,
      currencyCode: 'USD',
      glAccountId: 'gl2',
      openingBalance: 0,
      openingDate: null,
      isActive: true,
      notes: null,
    },
  ];

  const invoice = {
    id: 'i1',
    invoiceNumber: 'FAC-001',
    customerId: 'c1',
    balance: 11_800,
    currencyCode: 'DOP',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CustomerReceiptFormPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerReceiptFormPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne((c) => c.url === `${API}/customers`).flush([]);
    httpMock.expectOne((c) => c.url === `${API}/treasury/bank-accounts`).flush(bankAccounts);
    fixture.detectChanges();
  });

  const pickCustomer = () => {
    component.onCustomerChange('c1');
    httpMock
      .expectOne((c) => c.url === `${API}/invoices`)
      .flush({ items: [invoice, { ...invoice, id: 'i2', balance: 0 }], total: 2, page: 1, limit: 200, pages: 1 });
  };

  it('takes the currency from the bank account, not the user', () => {
    expect(component.form.value.currencyCode).toBe('DOP');
    component.onBankAccountChange('b2');
    expect(component.form.value.currencyCode).toBe('USD');
    httpMock.verify();
  });

  it('offers only invoices that still owe something', () => {
    pickCustomer();
    expect(component.openInvoices().map((i) => i.id)).toEqual(['i1']);
    httpMock.verify();
  });

  it('counts withholding as settling the invoice, not as cash', () => {
    pickCustomer();
    component.addInvoice(component.openInvoices()[0]);
    component.lines.at(0).patchValue({ amount: 10_000, taxWithheld: 1_800 });

    // 10,000 arrives, 1,800 the customer paid to the authority on our behalf: 11,800 settled.
    expect(component.settledBy(component.lines.at(0).value)).toBe(11_800);
    httpMock.verify();
  });

  it('posts the receipt with its lines', () => {
    pickCustomer();
    component.addInvoice(component.openInvoices()[0]);
    component.lines.at(0).patchValue({ amount: 10_000, taxWithheld: 1_800 });
    component.form.patchValue({ customerId: 'c1', amountReceived: 10_000 });

    component.save();
    const request = httpMock.expectOne((c) => c.url === `${API}/customer-payments`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toMatchObject({
      customerId: 'c1',
      bankAccountId: 'b1',
      currencyCode: 'DOP',
      amountReceived: 10_000,
    });
    expect(request.request.body.lines[0]).toMatchObject({
      invoiceId: 'i1',
      amount: 10_000,
      taxWithheld: 1_800,
    });
    request.flush({ id: 'r1' });
    httpMock.verify();
  });

  it('carries an overpayment as unapplied rather than refusing it', () => {
    pickCustomer();
    component.addInvoice(component.openInvoices()[0]);
    component.lines.at(0).patchValue({ amount: 5_000 });
    component.form.patchValue({ customerId: 'c1', amountReceived: 8_000 });

    // A customer paying ahead had nowhere to be recorded before; the difference is a credit.
    expect(component.totals().unapplied).toBe(3_000);
    httpMock.verify();
  });

  it('refuses to post when more is applied than was received', () => {
    pickCustomer();
    component.addInvoice(component.openInvoices()[0]);
    component.lines.at(0).patchValue({ amount: 11_800 });
    component.form.patchValue({ customerId: 'c1', amountReceived: 1_000 });

    component.save();
    httpMock.expectNone((c) => c.url === `${API}/customer-payments`);
    httpMock.verify();
  });
});
