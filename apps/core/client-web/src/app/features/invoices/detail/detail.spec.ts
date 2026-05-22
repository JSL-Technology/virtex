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
});
