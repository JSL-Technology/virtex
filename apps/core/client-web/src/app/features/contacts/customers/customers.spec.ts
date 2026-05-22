import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CustomersPage } from './customers.page';
import { CustomersService } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

describe('CustomersPage', () => {
  let component: CustomersPage;
  let fixture: ComponentFixture<CustomersPage>;
  let mockCustomersService: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockCustomersService = {
      getCustomers: jest.fn().mockReturnValue(of([])),
      deleteCustomer: jest.fn().mockReturnValue(of({})),
    };
    mockNotificationService = {
      showError: jest.fn(),
      showSuccess: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CustomersPage],
      providers: [
        { provide: CustomersService, useValue: mockCustomersService },
        { provide: NotificationService, useValue: mockNotificationService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomersPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
