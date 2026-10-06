import { provideTestBranches } from '../../../../core/tenancy/branches.service.testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { CustomersService } from '../../../../core/api/customers.service';
import { CurrenciesService } from '../../../../core/api/currencies.service';
import { InventoryService } from '../../../../core/api/inventory.service';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { Quote, QuotesService } from '../data/quotes.service';
import { QuoteFormPage } from './quote-form.page';

/** QA M-09: «Nueva cotización» led to «módulo en construcción». */
describe('QuoteFormPage', () => {
  const sent: Quote = {
    id: 'q-1', quoteNumber: 'COT-2026-000001', status: 'SENT', expired: false,
    customer: { id: 'c-1', companyName: 'Caribe' }, issueDate: '2026-10-01', expiryDate: '2026-10-16',
    currencyCode: 'DOP', subtotal: 270, discountTotal: 30, taxTotal: 48.6, total: 318.6, documentDiscountRate: 0,
    notes: null, sentAt: '2026-10-01T10:00:00Z', acceptedAt: null, rejectedAt: null, rejectionReason: null, invoiceId: null,
    lines: [{ lineOrder: 0, product: { id: 'p-1' }, description: 'Silla', quantity: 1.5, unitPrice: 200, discountRate: 0.1, taxRate: 0.18, taxAmount: 48.6, lineTotal: 270 }],
  };
  const api = {
    get: jest.fn(() => of(sent)),
    preview: jest.fn(() => of({ subtotal: 100, discountTotal: 0, tax: 18, total: 118, lines: [{ subtotal: 100, taxAmount: 18 }] })),
    create: jest.fn(() => of({ ...sent, status: 'DRAFT' })),
    update: jest.fn(),
    accept: jest.fn(() => of({ ...sent, status: 'ACCEPTED' })),
    convertToInvoice: jest.fn(() => of({ id: 'inv-9' })),
    markSent: jest.fn(), reject: jest.fn(), cancel: jest.fn(), duplicate: jest.fn(),
  };
  const dialog = { confirm: jest.fn(), prompt: jest.fn() };
  const notifications = { showSuccess: jest.fn(), showHttpError: jest.fn(), showError: jest.fn() };

  function create(id?: string) {
    TestBed.configureTestingModule({
      imports: [QuoteFormPage, TranslateModule.forRoot()],
      providers: [
        provideTestBranches(),
        provideRouter([]),
        { provide: QuotesService, useValue: api },
        { provide: DialogService, useValue: dialog },
        { provide: NotificationService, useValue: notifications },
        { provide: CurrenciesService, useValue: { getCurrencies: () => of([{ code: 'USD' }]) } },
        { provide: CustomersService, useValue: { searchCustomers: () => of([]), getCustomerById: () => of({ id: 'c-1', companyName: 'Caribe' }) } },
        { provide: InventoryService, useValue: { searchProducts: () => of([]), getProductById: () => of({ id: 'p-1', name: 'Silla' }) } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (p: string) => `/acme${p}` } },
      ],
    });
    const fixture = TestBed.createComponent(QuoteFormPage);
    fixture.componentInstance.id = id;
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => jest.clearAllMocks());

  it('starts a draft with one line, valid for fifteen days', () => {
    const page = create();
    expect(page.lines.length).toBe(1);
    const { issueDate, expiryDate } = page.form.getRawValue();
    expect((Date.parse(expiryDate) - Date.parse(issueDate)) / 86_400_000).toBe(15);
    expect(page.editable()).toBe(true);
  });

  it('sends what was written, trimmed, to be created', () => {
    const page = create();
    page.form.patchValue({ customerId: 'c-1' });
    page.lines.at(0).patchValue({ description: '  Mesa ', quantity: 2, unitPrice: 50, discountRate: 0.05 });
    page.save();
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'c-1', lines: [{ productId: undefined, description: 'Mesa', quantity: 2, unitPrice: 50, discountRate: 0.05 }] }),
    );
  });

  it('shows a sent quote read-only, with its stored totals, and offers acceptance', () => {
    const page = create('q-1');
    expect(page.editable()).toBe(false);
    expect(page.form.disabled).toBe(true);
    expect(page.totals()?.total).toBe(318.6);
    expect(page.canAccept()).toBe(true);
    expect(page.canSend()).toBe(false);
  });

  it('turns an accepted quote into an invoice after confirmation, and opens it', async () => {
    api.get.mockReturnValueOnce(of({ ...sent, status: 'ACCEPTED' }));
    const page = create('q-1');
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    dialog.confirm.mockResolvedValueOnce(false);
    await page.convert();
    expect(api.convertToInvoice).not.toHaveBeenCalled();

    dialog.confirm.mockResolvedValueOnce(true);
    await page.convert();
    expect(api.convertToInvoice).toHaveBeenCalledWith('q-1');
    expect(navigate).toHaveBeenCalledWith('/acme/invoices/inv-9');
  });

  it('does not offer acceptance once expired', () => {
    api.get.mockReturnValueOnce(of({ ...sent, expired: true }));
    const page = create('q-1');
    expect(page.canAccept()).toBe(false);
    expect(page.statusKey()).toBe('sales.quotes.status.expired');
  });
});
