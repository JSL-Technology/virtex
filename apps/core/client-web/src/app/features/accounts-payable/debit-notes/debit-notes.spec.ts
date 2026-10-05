import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { VendorDebitNoteFormPage } from './debit-note-form.page';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { ChartOfAccountsApiService } from '../../../core/api/chart-of-accounts.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';

/**
 * A debit note reduces one open bill: never by more than it owes, never giving back more tax than
 * the bill claimed, and charged back to the account the bill charged.
 */
describe('VendorDebitNoteFormPage', () => {
  const bill = {
    id: 'bill-1', vendorId: 's-1', vendor: { id: 's-1', name: 'Suplidora' }, ncf: 'B0100000001', date: '2026-03-05',
    dueDate: '2026-04-04', currencyCode: 'DOP', exchangeRate: 1, total: 11800, totalInBaseCurrency: 11800, balance: 11800,
    status: 'OPEN', taxAmount: 1800, taxToCost: 0, taxProportional: 0, taxWithheld: 0, incomeTaxWithheld: 0,
    lines: [{ product: 'Mercancía', quantity: 4, unitPrice: 2500, total: 10000, expenseAccountId: 'acc-5101' }],
  } as unknown as VendorBill;
  let payables: Record<string, jest.Mock>;

  function create() {
    payables = {
      getVendorBills: jest.fn().mockReturnValue(of([bill, { ...bill, id: 'paid', status: 'PAID', balance: 0 }])),
      getVendorBillById: jest.fn().mockReturnValue(of(bill)),
      createDebitNote: jest.fn().mockReturnValue(of({ id: 'nd-1', number: 'ND-2026-000001' })),
    };
    TestBed.configureTestingModule({
      imports: [VendorDebitNoteFormPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: AccountsPayableService, useValue: payables },
        { provide: ChartOfAccountsApiService, useValue: { searchAccounts: () => of([]), getAccountById: (id: string) => of({ id, code: '5101', name: { es: 'Compras' } }) } },
        { provide: NotificationService, useValue: { showSuccess: jest.fn(), showHttpError: jest.fn() } },
        { provide: ActiveOrganizationService, useValue: { urlFor: (path: string) => path } },
      ],
    });
    const fixture = TestBed.createComponent(VendorDebitNoteFormPage);
    fixture.componentRef.setInput('billId', 'bill-1');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('offers only open bills, opens on the one given, and charges back the account it charged', () => {
    const page = create();
    expect(page.bills().map((b) => b.id)).toEqual(['bill-1']);
    expect(page.form.value.vendorBillId).toBe('bill-1');
    expect(page.form.value.expenseAccountId).toBe('acc-5101');
    expect(page.deductibleTax()).toBe(1800);
  });

  it('refuses more than the bill owes, or more tax than it claimed', () => {
    const page = create();
    page.form.patchValue({ amount: 12000, taxAmount: 2000, reason: 'Devolución' });
    page.save();
    const messages = page.problems().map((p) => p.message);
    expect(messages).toContain('accounts_payable.debit_notes.exceeds_balance');
    expect(messages).toContain('accounts_payable.debit_notes.tax_exceeds_bill');
    expect(payables['createDebitNote']).not.toHaveBeenCalled();
  });

  it('posts the note with its tax part and the supplier NCF in capitals', () => {
    const page = create();
    page.form.patchValue({ amount: 1180, taxAmount: 180, reason: ' Dos unidades dañadas ', ncf: 'b0400000001', date: '2026-04-02' });
    page.save();
    expect(payables['createDebitNote']).toHaveBeenCalledWith({
      vendorBillId: 'bill-1',
      date: '2026-04-02',
      amount: 1180,
      taxAmount: 180,
      expenseAccountId: 'acc-5101',
      ncf: 'B0400000001',
      reason: 'Dos unidades dañadas',
    });
  });
});
