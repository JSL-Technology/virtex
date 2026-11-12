import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InvoiceDetailPage } from './detail.page';
import { InvoicesService } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

describe('InvoiceDetailPage', () => {
  let component: InvoiceDetailPage;
  let fixture: ComponentFixture<InvoiceDetailPage>;
  let mockInvoicesService: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockInvoicesService = {
      getInvoiceById: jest.fn().mockReturnValue(of({
        id: '1',
        invoiceNumber: 'INV-001',
        customerName: 'Test Customer',
        customerAddress: '123 Street',
        issueDate: '2023-01-01',
        dueDate: '2023-01-15',
        subtotal: 100,
        tax: 18,
        total: 118,
        status: 'Pending',
        lineItems: []
      })),
      // Whether the market issues debit notes through the product (FAC-INV-05).
      context: jest.fn().mockReturnValue(of({ debitNotes: false })),
    };
    mockNotificationService = {
      showError: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InvoiceDetailPage],
      providers: [
        { provide: InvoicesService, useValue: mockInvoicesService },
        { provide: NotificationService, useValue: mockNotificationService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InvoiceDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // FAC-INV-05: the screen offers a debit note only where the server would issue one.
  it('offers a debit note only in a market whose regime issues them', () => {
    const issued = { type: 'INVOICE', status: 'Pending' } as never;
    expect(component.debitNotesSupported()).toBe(false);
    expect(component.canDebit(issued)).toBe(false);
  });

  it('proposes a service for a charge and goods for a price increase, without deciding the tax', () => {
    component.startDebitNote();
    expect(component.debitLines()[0]).toMatchObject({ taxTreatment: 'TAXED', isService: true });
    component.setDebitReason('PRICE_INCREASE');
    expect(component.debitLines()[0].isService).toBe(false);
  });

  /**
   * The reason a note carries is the product's own, and the same taxonomy for either note. It used
   * to be the Dominican `CodigoModificacion`, which this screen could not offer at all.
   */
  it('asks why the credit note is issued, in terms no authority owns', () => {
    mockInvoicesService.createCreditNote = jest.fn().mockReturnValue(of({ invoiceNumber: 'NC-1' }));
    mockNotificationService.showSuccess = jest.fn();

    component.createCreditNote('1');
    expect(component.creditReasons).toContain('GOODS_RETURN');
    // A debit note's reason explains a charge added: a credit note is not offered one.
    expect(component.creditReasons).not.toContain('LATE_PAYMENT_INTEREST');
    expect(component.debitReasons).not.toContain('ANNULMENT');
    // One key family names both, so a reason reads the same wherever it is shown.
    expect(component.reasonKey('ANNULMENT')).toBe('invoices.adjustment_reason.annulment');
    expect(component.reasonKey('LATE_PAYMENT_INTEREST')).toBe('invoices.adjustment_reason.late_payment_interest');

    // The invoice the panel is confirming against, with a line to credit.
    component.invoice.set({ id: '1', lineItems: [{ id: 'line-1', quantity: 2, creditedQuantity: 0 }] } as never);
    component.setCreditAdjustmentReason('PRICE_REDUCTION');
    component.creditReason.set('Rebaja acordada con el cliente');
    component.setCreditQuantity('line-1', '1');
    component.confirmCredit();

    expect(mockInvoicesService.createCreditNote).toHaveBeenCalledWith(
      '1',
      expect.objectContaining({ adjustmentReason: 'PRICE_REDUCTION', reason: 'Rebaja acordada con el cliente' }),
    );
  });
});
