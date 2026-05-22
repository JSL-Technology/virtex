import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SuppliersPage } from './suppliers.page';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

describe('SuppliersPage', () => {
  let component: SuppliersPage;
  let fixture: ComponentFixture<SuppliersPage>;
  let mockSuppliersService: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockSuppliersService = {
      getSuppliers: jest.fn().mockReturnValue(of([])),
    };
    mockNotificationService = {
      showError: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SuppliersPage],
      providers: [
        { provide: SuppliersService, useValue: mockSuppliersService },
        { provide: NotificationService, useValue: mockNotificationService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SuppliersPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
