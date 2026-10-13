import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ProductFormPage } from './product-form.page';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { UnitsOfMeasureService } from '../../masters/data/units-of-measure.service';
import { ProductCategoriesService } from '../../../core/api/product-categories.service';
import { AiService, ProductSuggestion } from '../../ai/data/ai.service';
import { AuthService } from '../../../core/services/auth';

const suggestion = (overrides: Partial<ProductSuggestion> = {}): ProductSuggestion => ({
  imageId: 'img-1',
  isProductPhoto: true,
  name: { value: 'Café molido 453 g', confidence: 0.95 },
  description: { value: 'Café tostado y molido.', confidence: 0.8 },
  brand: { value: 'Santo Domingo', confidence: 0.97 },
  categoryId: { value: 'cat-1', confidence: 0.9 },
  unitOfMeasure: { value: 'KG', confidence: 0.7 },
  barcode: { value: '7501055363063', confidence: 0.92, check: 'valid' },
  kind: { value: 'GOOD', confidence: 0.99 },
  taxTreatment: { value: 'TAXED', confidence: 0.6 },
  taxRate: 0.18,
  attributes: { Peso: '453 g' },
  notes: '',
  possibleDuplicates: [],
  pricing: { typicalMarkup: 1.5, sampleSize: 8 },
  model: 'claude-opus-5-5',
  requestId: 'req-1',
  ...overrides,
});

const photo = () => new File([new Uint8Array([0xff, 0xd8, 0xff])], 'cafe.jpg', { type: 'image/jpeg' });
const choose = (component: ProductFormPage, file: File) =>
  component.onFileSelected({ target: { files: [file], value: 'x' } } as unknown as Event);

describe('ProductFormPage — product from photo', () => {
  let fixture: ComponentFixture<ProductFormPage>;
  let component: ProductFormPage;
  let ai: { status: jest.Mock; suggestProductFromImage: jest.Mock };
  let inventory: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;

  async function setup(options: { aiAvailable?: boolean; permitted?: boolean } = {}) {
    ai = {
      status: jest.fn().mockReturnValue(
        of({
          vision: { enabledByPlan: true, available: options.aiAvailable ?? true },
          forecasting: { enabledByPlan: true, available: true },
          anomalies: { enabledByPlan: true, available: true, explanations: true },
          duplicateImageSearch: false,
        }),
      ),
      suggestProductFromImage: jest.fn().mockReturnValue(of(suggestion())),
    };
    inventory = {
      getProductById: jest.fn(),
      createProduct: jest.fn().mockReturnValue(of({})),
      updateProduct: jest.fn().mockReturnValue(of({})),
      uploadProductImage: jest.fn().mockReturnValue(of({ id: 'plain-img', width: 10, height: 10 })),
    };
    notifications = {
      showError: jest.fn(),
      showSuccess: jest.fn(),
      showWarning: jest.fn(),
      showHttpError: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [ProductFormPage],
      providers: [
        { provide: InventoryService, useValue: inventory },
        { provide: NotificationService, useValue: notifications },
        { provide: AiService, useValue: ai },
        { provide: AuthService, useValue: { hasPermissions: () => options.permitted ?? true } },
        {
          provide: ProductCategoriesService,
          useValue: { list: () => of([{ id: 'cat-1', name: 'Café' }]) },
        },
        {
          provide: UnitsOfMeasureService,
          useValue: {
            list: () =>
              of([
                { id: 'u1', symbol: 'UND', category: 'Units', nameKey: 'uom.unit' },
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
  }

  it('fills the untouched fields from the photo and marks them as suggested', async () => {
    await setup();
    choose(component, photo());

    const form = component.productForm;
    expect(ai.suggestProductFromImage).toHaveBeenCalled();
    expect(form.get('name')?.value).toBe('Café molido 453 g');
    expect(form.get('brand')?.value).toBe('Santo Domingo');
    expect(form.get('barcode')?.value).toBe('7501055363063');
    expect(form.get('categoryId')?.value).toBe('cat-1');
    expect(form.get('unitOfMeasure')?.value).toBe('KG');
    expect(component.confidenceOf('name')).toBe(0.95);
    expect(component.attributes()).toEqual([{ key: 'Peso', value: '453 g' }]);
    expect(component.photoState()).toBe('done');
  });

  it('never overwrites what the person already typed', async () => {
    await setup();
    const name = component.productForm.get('name')!;
    name.setValue('Mi nombre');
    name.markAsDirty();

    choose(component, photo());

    expect(name.value).toBe('Mi nombre');
    expect(component.confidenceOf('name')).toBeNull();
    expect(component.productForm.get('brand')?.value).toBe('Santo Domingo');
  });

  it('drops the suggested badge as soon as the person edits the field', async () => {
    await setup();
    choose(component, photo());
    component.productForm.get('brand')!.setValue('Otra marca');
    expect(component.confidenceOf('brand')).toBeNull();
    expect(component.confidenceOf('name')).toBe(0.95);
  });

  it('leaves out a barcode that failed its check digit', async () => {
    await setup();
    ai.suggestProductFromImage.mockReturnValue(
      of(suggestion({ barcode: { value: '7501055363064', confidence: 0, check: 'invalid' } })),
    );
    choose(component, photo());
    expect(component.productForm.get('barcode')?.value).toBe('');
  });

  it('sends the photo with the new product, so it is claimed in the same request', async () => {
    await setup();
    choose(component, photo());
    component.productForm.get('price')!.setValue(10);
    component.saveProduct();
    const payload = inventory['createProduct'].mock.calls[0][0];
    expect(payload.imageIds).toEqual(['img-1']);
    expect(payload.attributes).toEqual({ Peso: '453 g' });
    expect(payload.barcode).toBe('7501055363063');
  });

  it('suggests a price from the tenant\'s own markup, never from the model', async () => {
    await setup();
    choose(component, photo());
    expect(component.suggestedPrice()).toBeNull();
    component.productForm.get('cost')!.setValue(20);
    expect(component.suggestedPrice()).toBe(30);
    component.applySuggestedPrice();
    expect(component.productForm.get('price')?.value).toBe(30);
  });

  it('falls back to storing the photo when the analysis fails, and the form still works', async () => {
    await setup();
    ai.suggestProductFromImage.mockReturnValue(throwError(() => ({ status: 503 })));
    choose(component, photo());
    expect(notifications['showHttpError']).toHaveBeenCalled();
    expect(inventory['uploadProductImage']).toHaveBeenCalled();
    expect(component.productForm.get('name')?.value).toBe('');
  });

  it('only stores the photo when the plan, the server or the role does not allow the AI', async () => {
    await setup({ permitted: false });
    expect(component.canUseAi()).toBe(false);
    choose(component, photo());
    expect(ai.suggestProductFromImage).not.toHaveBeenCalled();
    expect(inventory['uploadProductImage']).toHaveBeenCalled();
  });

  it('warns instead of filling when the photo is not of a product', async () => {
    await setup();
    ai.suggestProductFromImage.mockReturnValue(of(suggestion({ isProductPhoto: false })));
    choose(component, photo());
    expect(notifications['showWarning']).toHaveBeenCalledWith('ai.photo.not_a_product');
    expect(component.productForm.get('name')?.value).toBe('');
  });
});
