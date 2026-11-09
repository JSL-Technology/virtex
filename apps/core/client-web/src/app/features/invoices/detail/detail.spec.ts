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
});
