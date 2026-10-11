import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProductFormPage } from './product-form.page';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';
import { UnitsOfMeasureService } from '../../masters/data/units-of-measure.service';

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
        {
          provide: UnitsOfMeasureService,
          useValue: {
            list: () => of([
              { id: 'u1', symbol: 'UND', category: 'Units', nameKey: 'uom.unit' },
              { id: 'u2', symbol: 'SRV', category: 'Units', nameKey: 'uom.service' },
              { id: 'u3', symbol: 'KG', category: 'Weight', nameKey: 'uom.kilogram' },
            ]),
          },
        },
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

  it('offers the unit catalogue and starts a product in units', () => {
    expect(component.unitOptions().map((u) => u.symbol)).toEqual(['UND', 'SRV', 'KG']);
    expect(component.productForm.get('unitOfMeasure')?.value).toBe('UND');
  });

  it('sells a service by the service, unless a unit was already chosen', () => {
    component.productForm.get('kind')?.setValue('SERVICE');
    expect(component.productForm.get('unitOfMeasure')?.value).toBe('SRV');

    component.productForm.get('kind')?.setValue('GOOD');
    const unit = component.productForm.get('unitOfMeasure');
    unit?.setValue('KG');
    unit?.markAsDirty();
    component.productForm.get('kind')?.setValue('SERVICE');
    expect(unit?.value).toBe('KG');
  });
});
