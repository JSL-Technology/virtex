import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductFormPage } from './product-form.page';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

describe('ProductFormPage', () => {
  let component: ProductFormPage;
  let fixture: ComponentFixture<ProductFormPage>;
  let mockInventoryService: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockInventoryService = {
      getProductById: jest.fn().mockReturnValue(of({
        id: '1',
        name: 'Test Product',
        price: 10,
        stock: 100,
        status: 'Active'
      })),
      createProduct: jest.fn().mockReturnValue(of({})),
      updateProduct: jest.fn().mockReturnValue(of({})),
    };
    mockNotificationService = {
      showError: jest.fn(),
      showSuccess: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProductFormPage],
      providers: [
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: NotificationService, useValue: mockNotificationService },
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductFormPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
