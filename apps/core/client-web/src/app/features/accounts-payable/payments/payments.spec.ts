import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { VendorPaymentsPage } from './payments.page';
import { VendorPaymentDetailPage } from './payment-detail.page';
import { AccountsPayableService, PaymentBatch } from '../../../core/services/accounts-payable';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { TreasuryService } from '../../../core/api/treasury.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { provideTestBranches } from '../../../core/tenancy/branches.service.testing';

/** Payments to suppliers are a list and documents: filtered on the server, voidable while paid. */
describe('payments to suppliers', () => {
  const row = {
    id: 'pay-1', number: 'PAY-2026-000001', paymentDate: '2026-03-20', status: 'PAID' as const, reference: null,
    branchId: null, journalEntryId: 'je-1', bankAccountId: 'b-1', bankAccountName: 'Corriente', currencyCode: 'DOP',
    totalPaid: 13000, billCount: 2, suppliers: 'Suplidora',
  };
  const batch: PaymentBatch = {
    id: 'pay-1', number: 'PAY-2026-000001', paymentDate: '2026-03-20', bankAccountId: 'b-1', reference: null, status: 'PAID',
    journalEntryId: 'je-1', bankAccount: { id: 'b-1', name: 'Corriente', currencyCode: 'DOP' },
    payments: [
      { id: 'vp-1', vendorBillId: 'bill-1', date: '2026-03-20', amount: 8000, amountPaid: 8000, taxWithheld: 0, incomeTaxWithheld: 0, discount: 0, exchangeDifference: 0, exchangeRate: 1 },
      { id: 'vp-2', vendorBillId: 'bill-2', date: '2026-03-20', amount: 5000, amountPaid: 5000, taxWithheld: 0, incomeTaxWithheld: 0, discount: 0, exchangeDifference: 0, exchangeRate: 1 },
    ],
  };
  let payables: Record<string, jest.Mock>;

  function configure() {
    payables = {
      payments: jest.fn().mockReturnValue(of({ items: [row], total: 1, page: 1, limit: 50, pages: 1 })),
      payment: jest.fn().mockReturnValue(of(batch)),
      voidPayment: jest.fn().mockReturnValue(of({ ...batch, status: 'VOID' })),
    };
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideTestBranches(),
        { provide: AccountsPayableService, useValue: payables },
        { provide: SuppliersService, useValue: { searchSuppliers: () => of([]), getSupplierById: () => of(null) } },
        { provide: TreasuryService, useValue: { listBankAccounts: () => of([]) } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn(), httpErrorMessage: () => 'x' } },
        { provide: DialogService, useValue: { prompt: jest.fn().mockResolvedValue('Cheque devuelto') } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
        { provide: AuthService, useValue: { isAuthenticated$: of(true), getPermissions$: () => of(['accounts_payable:void']), hasPermissions: () => true } },
      ],
    });
  }

  it('lists them, and a new filter goes back to the first page', () => {
    configure();
    const fixture = TestBed.createComponent(VendorPaymentsPage);
    fixture.detectChanges();
    const page = fixture.componentInstance;
    expect(page.rows()).toEqual([row]);
    page.goToPage(2);
    page.statusFilter.set('VOID');
    page.applyFilters();
    expect(payables['payments']).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'VOID', page: 1 }));
  });

  it('reads one with what left the bank, and voids it after asking why', async () => {
    configure();
    const fixture = TestBed.createComponent(VendorPaymentDetailPage);
    fixture.componentRef.setInput('id', 'pay-1');
    fixture.detectChanges();
    const page = fixture.componentInstance;
    expect(page.totalPaid()).toBe(13000);
    expect(page.canVoid()).toBe(true);

    payables['payment'].mockReturnValue(of({ ...batch, status: 'VOID' }));
    await page.voidPayment();
    expect(payables['voidPayment']).toHaveBeenCalledWith('pay-1', 'Cheque devuelto');
    expect(page.payment()?.status).toBe('VOID');
    expect(page.canVoid()).toBe(false);
  });
});
