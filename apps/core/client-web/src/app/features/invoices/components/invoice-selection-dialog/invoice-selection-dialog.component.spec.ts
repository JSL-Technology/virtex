import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { InvoiceSelectionDialogComponent } from './invoice-selection-dialog.component';
import { InvoicesService, Invoice } from '../../../../core/services/invoices';

/**
 * «Copiar de» (QA A-09).
 *
 * The dialog stored `() => callback`, so picking an invoice called a function that only returned
 * the callback: nothing was ever copied. It also fetched fifty invoices on every new-invoice page,
 * whether or not the dialog was ever opened.
 */
describe('InvoiceSelectionDialogComponent', () => {
  const invoice = { id: 'inv-1', invoiceNumber: 'B0100000001', customerName: 'Acme' } as Invoice;
  let getInvoices: jest.Mock;
  let component: InvoiceSelectionDialogComponent;

  beforeEach(() => {
    getInvoices = jest.fn().mockReturnValue(of({ items: [invoice], total: 1, page: 1, limit: 50 }));
    TestBed.configureTestingModule({
      imports: [InvoiceSelectionDialogComponent, TranslateModule.forRoot()],
      providers: [{ provide: InvoicesService, useValue: { getInvoices } }],
    });
    component = TestBed.createComponent(InvoiceSelectionDialogComponent).componentInstance;
  });

  it('fetches nothing until it is opened', () => {
    expect(getInvoices).not.toHaveBeenCalled();
    component.open(() => undefined);
    expect(getInvoices).toHaveBeenCalledTimes(1);
    expect(component.invoices()).toEqual([invoice]);
  });

  it('hands the chosen invoice to the caller and closes', () => {
    const chosen = jest.fn();
    component.open(chosen);
    component.selectInvoice(invoice);
    expect(chosen).toHaveBeenCalledWith(invoice);
    expect(component.isOpen()).toBe(false);
  });
});
