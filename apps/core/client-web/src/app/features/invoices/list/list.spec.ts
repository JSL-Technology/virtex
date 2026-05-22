import { ComponentFixture, TestBed } from '@angular/core/testing';
import { InvoicesListPage } from './list.page';
import { InvoicesService } from '../../../core/services/invoices';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

describe('InvoicesListPage', () => {
  let component: InvoicesListPage;
  let fixture: ComponentFixture<InvoicesListPage>;
  let mockInvoicesService: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockInvoicesService = {
      getInvoices: jest.fn().mockReturnValue(of([])),
    };
    mockNotificationService = {
      showError: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [InvoicesListPage],
      providers: [
        { provide: InvoicesService, useValue: mockInvoicesService },
        { provide: NotificationService, useValue: mockNotificationService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InvoicesListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
