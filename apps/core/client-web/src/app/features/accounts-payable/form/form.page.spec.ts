import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { VendorBillFormPage } from './form.page';
import { environment } from '../../../../environments/environment';

/**
 * The request body is the contract, and it was wrong in every field.
 *
 * The form posted `supplierId`, `billNumber`, `issueDate` and
 * `lineItems[{description, quantity, price}]`. `CreateVendorBillDto` on the server requires
 * `vendorId`, `date`, `dueDate` and `lines[{product, quantity, unitPrice, total}]`, and the global
 * pipe runs with `whitelist` and `forbidNonWhitelisted`, so the POST was rejected twice over —
 * unknown properties, and three required ones missing. No bill could be created from this screen,
 * and the component turned the 400 into a generic "could not save".
 *
 * These assertions are about the body, not the rendering, because the body is what broke.
 */
describe('VendorBillFormPage', () => {
  let fixture: ComponentFixture<VendorBillFormPage>;
  let component: VendorBillFormPage;
  let httpMock: HttpTestingController;

  const API = environment.apiUrl;

  const suppliers = [
    { id: 's1', name: 'Suplidora del Caribe' },
    { id: 's2', name: 'Licencias SA' },
  ];

  const accounts = [
    {
      id: 'a1',
      code: '5101',
      name: { es: 'Gastos operativos', en: 'Operating expenses' },
      type: 'EXPENSE',
      isPostable: true,
      isBlockedForPosting: false,
    },
    {
      id: 'a2',
      code: '4101',
      name: { es: 'Ingresos' },
      type: 'REVENUE',
      isPostable: true,
      isBlockedForPosting: false,
    },
    {
      id: 'a3',
      code: '5199',
      name: { es: 'Gasto bloqueado' },
      type: 'EXPENSE',
      isPostable: true,
      isBlockedForPosting: true,
    },
    {
      id: 'a4',
      code: '5100',
      name: { es: 'Encabezado de gastos' },
      type: 'EXPENSE',
      isPostable: false,
      isBlockedForPosting: false,
    },
  ];

  const flushPickers = () => {
    httpMock.expectOne(`${API}/suppliers`).flush(suppliers);
    httpMock.expectOne(`${API}/chart-of-accounts`).flush(accounts);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VendorBillFormPage, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(VendorBillFormPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('offers only postable, unblocked expense accounts', () => {
    flushPickers();
    const offered = component.expenseAccounts().map((account) => account.code);
    expect(offered).toEqual(['5101']);
  });

  it('reads an account name out of its translation map instead of printing an object', () => {
    flushPickers();
    expect(component.expenseAccounts()[0].name).toBe('Gastos operativos');
  });

  it('posts the field names the server actually requires', () => {
    flushPickers();

    component.form.patchValue({
      vendorId: 's1',
      date: '2026-03-15',
      dueDate: '2026-04-15',
      taxAmount: 1800,
    });
    component.lines.at(0).patchValue({
      product: 'Servicio de hosting',
      quantity: 2,
      unitPrice: 5000,
      expenseAccountId: 'a1',
    });

    component.save();

    const request = httpMock.expectOne(`${API}/accounts-payable`);
    expect(request.request.method).toBe('POST');

    const body = request.request.body;
    expect(body.vendorId).toBe('s1');
    expect(body.date).toBe('2026-03-15');
    expect(body.dueDate).toBe('2026-04-15');
    expect(body.lines).toEqual([
      {
        product: 'Servicio de hosting',
        quantity: 2,
        unitPrice: 5000,
        total: 10_000,
        expenseAccountId: 'a1',
      },
    ]);

    // And none of the names the server would reject as unknown properties.
    expect(body.supplierId).toBeUndefined();
    expect(body.billNumber).toBeUndefined();
    expect(body.issueDate).toBeUndefined();
    expect(body.lineItems).toBeUndefined();

    request.flush({ id: 'bill-1' });
  });

  it('sends the document total the server will compute for itself', () => {
    flushPickers();

    component.form.patchValue({
      vendorId: 's1',
      date: '2026-03-15',
      dueDate: '2026-04-15',
      taxAmount: 1800,
      serviceCharge: 1000,
    });
    component.lines.at(0).patchValue({
      product: 'Comida',
      quantity: 1,
      unitPrice: 10_000,
      expenseAccountId: 'a1',
    });

    component.save();

    const request = httpMock.expectOne(`${API}/accounts-payable`);
    // subtotal 10 000 + tax 1 800 + service charge 1 000. The server recomputes this and rejects
    // the request if the two disagree, so a client that guesses differently fails loudly.
    expect(request.request.body.total).toBe(12_800);
    request.flush({ id: 'bill-1' });
  });

  it('carries the fiscal breakdown the ledger entry is posted from', () => {
    flushPickers();

    component.form.patchValue({
      vendorId: 's1',
      date: '2026-03-15',
      dueDate: '2026-04-15',
      taxAmount: 1800,
      taxWithheld: 540,
      incomeTaxWithheld: 1000,
      taxToCost: 200,
      purchaseCategory: '02',
      paymentForm: '02',
    });
    component.lines.at(0).patchValue({
      product: 'Honorarios',
      quantity: 1,
      unitPrice: 10_000,
      expenseAccountId: 'a1',
    });

    component.save();

    const request = httpMock.expectOne(`${API}/accounts-payable`);
    const body = request.request.body;
    expect(body.taxAmount).toBe(1800);
    expect(body.taxWithheld).toBe(540);
    expect(body.incomeTaxWithheld).toBe(1000);
    expect(body.taxToCost).toBe(200);
    expect(body.purchaseCategory).toBe('02');
    expect(body.paymentForm).toBe('02');
    request.flush({ id: 'bill-1' });
  });

  it('shows what the supplier is owed after withholding', () => {
    flushPickers();

    component.form.patchValue({
      vendorId: 's1',
      taxAmount: 1800,
      taxWithheld: 540,
      incomeTaxWithheld: 1000,
    });
    component.lines.at(0).patchValue({
      product: 'Honorarios',
      quantity: 1,
      unitPrice: 10_000,
      expenseAccountId: 'a1',
    });

    const totals = component.totals();
    expect(totals.total).toBe(11_800);
    expect(totals.withheld).toBe(1540);
    expect(totals.payable).toBe(10_260);
  });

  it('will not save a document with nothing on it', () => {
    flushPickers();
    expect(component.canSave()).toBe(false);
  });
});
