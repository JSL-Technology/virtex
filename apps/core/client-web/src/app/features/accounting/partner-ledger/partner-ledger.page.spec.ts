import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PartnerLedgerPage } from './partner-ledger.page';
import { StatementsService, documentRoute } from '../data/statements.service';
import { CustomersService } from '../../contacts/data/customers.service';
import { SuppliersService } from '../../contacts/data/suppliers.service';
import { NotificationService } from '../../../core/services/notification';

describe('PartnerLedgerPage', () => {
  const statement = {
    partnerId: 's-1', partnerName: 'Suplidora', currencyCode: 'DOP', currencies: ['DOP', 'USD'], from: '2026-04-01', to: '2026-04-30',
    openingBalance: 12000,
    movements: [{ date: '2026-04-02', kind: 'vendor_debit_note', documentId: 'n-1', reference: 'ND-2026-000001', amount: -1000, balance: 11000 }],
    totals: { increases: 0, decreases: 1000 }, closingBalance: 11000,
  };
  let statementFn: jest.Mock;

  function create(inputs: Record<string, string> = {}) {
    statementFn = jest.fn().mockReturnValue(of(statement));
    TestBed.configureTestingModule({
      imports: [PartnerLedgerPage, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: StatementsService, useValue: { statement: statementFn } },
        { provide: CustomersService, useValue: { searchCustomers: () => of([]), getCustomerById: (id: string) => of({ id, companyName: 'Cliente' }) } },
        { provide: SuppliersService, useValue: { searchSuppliers: () => of([]), getSupplierById: (id: string) => of({ id, name: 'Suplidora' }) } },
        { provide: NotificationService, useValue: { httpErrorMessage: () => 'x' } },
      ],
    });
    const fixture = TestBed.createComponent(PartnerLedgerPage);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('opens on the partner it was sent to and loads the statement', () => {
    const page = create({ type: 'supplier', partnerId: 's-1' });
    expect(page.kind()).toBe('supplier');
    expect(statementFn).toHaveBeenCalledWith('supplier', 's-1', expect.objectContaining({ currency: null }));
    expect(page.statement()?.closingBalance).toBe(11000);
  });

  it('switching partner type clears the statement', () => {
    const page = create({ type: 'supplier', partnerId: 's-1' });
    page.setKind('customer');
    expect(page.statement()).toBeNull();
    expect(page.partner()).toBeNull();
  });

  it('asks again in another currency', () => {
    const page = create({ type: 'supplier', partnerId: 's-1' });
    page.currency.set('USD');
    page.load();
    expect(statementFn).toHaveBeenLastCalledWith('supplier', 's-1', expect.objectContaining({ currency: 'USD' }));
  });

  it('links each line to its document', () => {
    expect(documentRoute('invoice', 'i')).toEqual(['/invoices', 'i']);
    expect(documentRoute('payment_void', 'p')).toEqual(['/accounts-payable/payments', 'p']);
    expect(documentRoute('vendor_debit_note', 'n')).toEqual(['/accounts-payable/debit-notes', 'n']);
    expect(documentRoute('receipt', 'r')).toBeNull();
  });
});
