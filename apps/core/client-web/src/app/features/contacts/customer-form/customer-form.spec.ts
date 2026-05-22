import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomerFormPage } from './customer-form.page';
import { CustomersService } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

describe('CustomerFormPage', () => {
  let component: CustomerFormPage;
  let fixture: ComponentFixture<CustomerFormPage>;
  let mockCustomersService: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockCustomersService = {
      getCustomerById: jest.fn().mockReturnValue(of({
        id: '1',
        companyName: 'Test Customer',
        email: 'test@example.com',
        phone: '123456789'
      })),
      createCustomer: jest.fn().mockReturnValue(of({})),
      updateCustomer: jest.fn().mockReturnValue(of({})),
    };
    mockNotificationService = {
      showError: jest.fn(),
      showSuccess: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CustomerFormPage],
      providers: [
        { provide: CustomersService, useValue: mockCustomersService },
        { provide: NotificationService, useValue: mockNotificationService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomerFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
