import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { InvoicesService } from '../../../core/services/invoices';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Image, ScanBarcode, Sparkles, X } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { AiService, ExternalProductReference, ProductMatch, ProductSuggestion } from '../../ai/data/ai.service';
import { BarcodeScannerComponent } from '../../ai/barcode-scanner/barcode-scanner.component';
import { AuthService } from '../../../core/services/auth';
import { InventoryService, CreateProductDto, UpdateProductDto } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import {
  ProductCategoriesService,
  ProductCategory,
} from '../../../core/api/product-categories.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { TranslateService } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { UnitOfMeasure, UnitsOfMeasureService } from '../../masters/data/units-of-measure.service';

@Component({
  selector: 'app-product-form-page',
  imports: [ReactiveFormsModule, RouterLink, HasPermissionDirective, LucideAngularModule, TranslateModule, DraftShellComponent, BarcodeScannerComponent, ...VX_FORM_A11Y, ...FORMAT_PIPES],
  templateUrl: './product-form.page.html',
  styleUrls: ['./product-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  id = input<string>();

  private fb = inject(FormBuilder);
  private router = inject(Router);
  // private route = inject(ActivatedRoute);
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);
  private categoriesService = inject(ProductCategoriesService);
  private readonly unitsApi = inject(UnitsOfMeasureService);
  private readonly invoices = inject(InvoicesService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly warehousesApi = inject(WarehousesService);

  /** Where the opening stock can go; the field shows only when there is a choice. */
  readonly warehouses = signal<Warehouse[]>([]);

  protected readonly ImageIcon = Image;
  protected readonly SparklesIcon = Sparkles;
  protected readonly ScanIcon = ScanBarcode;
  protected readonly RemoveIcon = X;
  /** A catalogue key whose leaf comes from data: `('x', 'STOCKOUT_RISK')` → `x.stockout_risk`. */
  protected readonly k = composeKey;

  private readonly ai = inject(AiService);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);

  /**
   * Whether a photo is read by the AI. Asked once: the plan, the server's configuration and the
   * provider's health are the server's to know. A failure answers "no" and the photo is simply
   * stored, which is what the form did before there was any AI.
   */
  private readonly aiStatus = toSignal(this.ai.status().pipe(catchError(() => of(null))), { initialValue: null });
  readonly canUseAi = computed(
    () => !this.isEditMode() && !!this.aiStatus()?.vision.available && this.auth.hasPermissions(['ai_vision:use']),
  );

  /** Where the photo is in its journey: stored, being read, read, or failed. */
  readonly photoState = signal<'idle' | 'uploading' | 'analysing' | 'done' | 'error'>('idle');
  /** Photos stored for this draft, claimed by the product when it is created. */
  private readonly imageIds = signal<string[]>([]);
  readonly suggestion = signal<ProductSuggestion | null>(null);
  /** Products that already carry a barcode just scanned. */
  readonly scanMatches = signal<ProductMatch[]>([]);
  readonly duplicates = computed<ProductMatch[]>(() => {
    const all = [...this.scanMatches(), ...(this.suggestion()?.possibleDuplicates ?? [])];
    return all.filter((match, index) => all.findIndex((other) => other.id === match.id) === index);
  });
  /** The camera scanner is open. */
  readonly scanning = signal(false);
  /** What a public product database said about the barcode, shown for the person to check. */
  readonly reference = signal<ExternalProductReference | null>(null);
  /**
   * The AI and the public references fill everything except money: price and cost are the
   * company's own, and until someone sets them the product would sell at zero.
   */
  readonly pricingPending = computed(
    () =>
      !this.isEditMode() &&
      (!!this.suggestion()?.isProductPhoto || !!this.reference()) &&
      !(this.priceValue() > 0) &&
      !(this.costValue() > 0),
  );
  /**
   * The fields the AI filled and nobody has touched since, with the model's confidence. A field
   * leaves this map the moment its value changes, so a badge never claims a value the person wrote.
   */
  private readonly suggested = signal<Record<string, number>>({});
  readonly attributes = signal<Array<{ key: string; value: string }>>([]);

  /** Qué falta antes de guardar. Se llena al pulsar, no mientras se teclea el primer campo. */
  readonly problems = signal<DraftProblem[]>([]);

  productForm!: FormGroup;
  /**
   * The tenant's own categories.
   *
   * The field used to be a `<select>` with `Electrónica`, `Accesorios` and `Monitores` written into
   * the template — a demo catalogue from a computer shop, offered to every tenant in every market
   * as the only three things they could be selling.
   */
  readonly categories = signal<ProductCategory[]>([]);

  /**
   * The units the field offers. The product's own unit is always among them — a code the catalogue
   * does not list (an import, a unit retired later) must not be silently replaced on save.
   */
  private readonly units = signal<UnitOfMeasure[]>([]);
  readonly unitOptions = computed<Pick<UnitOfMeasure, 'symbol' | 'nameKey' | 'name'>[]>(() => {
    const units = this.units();
    const current = this.currentUnit();
    return current && !units.some((unit) => unit.symbol === current)
      ? [{ symbol: current, nameKey: current }, ...units]
      : units.length ? units : [{ symbol: 'UND', nameKey: 'uom.unit' }];
  });
  private readonly currentUnit = signal<string | null>(null);
  isEditMode = signal(false);
  isLoading = signal(true);
  imagePreview = signal<string | ArrayBuffer | null>(null);
  private productId: string | null = null;

  constructor() {
    effect(() => {
      const idValue = this.id();
      if (idValue) {
        this.isEditMode.set(true);
        this.loadProductData(idValue);
      } else {
        this.isEditMode.set(false);
        this.isLoading.set(false);
      }
    });
  }

  ngOnInit(): void {
    this.loadCategories();
    this.loadUnits();
    this.warehousesApi.list().subscribe({
      next: (rows) => this.warehouses.set(rows.filter((warehouse) => warehouse.isActive)),
      error: () => this.warehouses.set([]),
    });
    this.productForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(255)]],
      sku: [''],
      description: [''],
      categoryId: [null],
      price: [0, [Validators.required, Validators.min(0)]],
      cost: [0, [Validators.min(0)]],
      //  Lo que el artículo tiene al crearlo: su saldo inicial, en el almacén que se elija.
      stock: [0, [Validators.required, Validators.min(0)]],
      warehouseId: [''],
      reorderLevel: [0],
      status: ['Active', Validators.required],
      //  Bien o servicio: un servicio no se cuenta ni mueve existencias.
      kind: ['GOOD'],
      //  Unit of measure, from the platform catalogue. `UND` is what the column defaults to.
      unitOfMeasure: ['UND'],
      //  Tratamiento fiscal y tasa. El formulario no los tenía, así que todo producto nacía
      //  «gravado al 0 %» y el punto de venta cobraba sin impuesto (QA C-08). La tasa se elige de
      //  las que el mercado del inquilino aplica y viaja como fracción (0.18), nunca como 18.
      taxTreatment: ['TAXED'],
      taxRate: [null as number | null],
      barcode: ['', [Validators.maxLength(64), Validators.pattern(/^[0-9A-Za-z-]*$/)]],
      brand: ['', [Validators.maxLength(120)]],
    });

    this.productForm.get('cost')?.valueChanges.subscribe((cost) => this.costValue.set(Number(cost) || 0));
    this.productForm.get('price')?.valueChanges.subscribe((price) => this.priceValue.set(Number(price) || 0));

    // A suggestion stops being one as soon as the person changes the field.
    for (const field of SUGGESTIBLE_FIELDS) {
      this.productForm.get(field)?.valueChanges.subscribe(() => {
        if (this.applyingSuggestion) return;
        this.suggested.update((map) => {
          if (!(field in map)) return map;
          const { [field]: _removed, ...rest } = map;
          return rest;
        });
      });
    }

    this.productForm.get('taxTreatment')?.valueChanges.subscribe((treatment) => {
      const rate = this.productForm.get('taxRate');
      if (treatment !== 'TAXED') rate?.setValue(0, { emitEvent: false });
      else if (!Number(rate?.value)) rate?.setValue(this.taxRates()[0] ?? null, { emitEvent: false });
    });
    this.productForm.get('kind')?.valueChanges.subscribe((kind) => {
      // A service is sold by the service unless someone already chose a unit.
      const unit = this.productForm.get('unitOfMeasure');
      if (unit && !unit.dirty) unit.setValue(kind === 'SERVICE' ? 'SRV' : 'UND', { emitEvent: false });
      const stock = this.productForm.get('stock');
      if (kind === 'SERVICE') {
        stock?.setValue(0, { emitEvent: false });
        stock?.disable({ emitEvent: false });
      } else if (!this.isEditMode()) {
        stock?.enable({ emitEvent: false });
      }
    });
  }

  /** The rates the tenant's market levies, highest first — the standard rate leads. */
  readonly taxRates = computed(() => this.invoicingContext()?.taxRates ?? []);
  private readonly invoicingContext = toSignal(this.invoices.context(), { initialValue: null });

  /** Preselect the standard rate on a new product once the market's rates are known. */
  private readonly presetRate = effect(() => {
    const standard = this.taxRates()[0];
    const control = this.productForm?.get('taxRate');
    if (standard !== undefined && control && control.value === null && !this.isEditMode()) {
      control.setValue(standard, { emitEvent: false });
    }
  });

  /**
   * Load the catalogue's categories.
   *
   * A failure is not fatal: the field simply offers nothing, and the rest of the form still saves.
   * Blocking the whole product form because one dropdown could not be filled would be a worse
   * outcome than a product filed under nothing.
   */
  /** Load the unit catalogue. Like categories, a failure leaves the field with the default only. */
  private loadUnits(): void {
    this.unitsApi.list().subscribe({
      next: (rows) => this.units.set(rows),
      error: () => this.units.set([]),
    });
  }

  private loadCategories(): void {
    this.categoriesService.list().subscribe({
      next: (rows) => this.categories.set(rows),
      error: () => this.categories.set([]),
    });
  }

  loadProductData(id: string): void {
    this.isLoading.set(true);
    this.inventoryService.getProductById(id).subscribe({
      next: (product) => {
        this.productForm.patchValue(product);
        this.attributes.set(
          Object.entries(product.attributes ?? {}).map(([key, value]) => ({ key, value: String(value) })),
        );
        this.currentUnit.set(product.unitOfMeasure ?? null);
        this.onHand.set(Number(product.stock ?? 0));
        //  Las existencias son el saldo de los movimientos: se ven aquí y se cambian con un ajuste
        //  de inventario, que tiene almacén, motivo, número y asiento. El costo de lo que ya se tiene
        //  también: cambiarlo revalúa existencias, y eso es un ajuste.
        this.productForm.get('stock')?.disable({ emitEvent: false });
        if (Number(product.stock ?? 0) !== 0 && product.kind !== 'SERVICE') {
          this.productForm.get('cost')?.disable({ emitEvent: false });
        }
        if (product.imageUrl) {
          this.imagePreview.set(product.imageUrl);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('inventory.product_form.product_could_not_loaded');
        this.router.navigate(['/inventory/products']);
      }
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.imagePreview.set(reader.result);
    reader.readAsDataURL(file);
    // Choosing the same file again must fire `change` again.
    input.value = '';

    //  An existing product keeps the behaviour it had: the photo is previewed only.
    if (this.isEditMode()) return;
    if (this.canUseAi()) this.analysePhoto(file);
    else this.storePhoto(file);
  }

  /** Store the photo so the product can claim it, with no analysis. */
  private storePhoto(file: File): void {
    this.photoState.set('uploading');
    this.inventoryService.uploadProductImage(file).subscribe({
      next: ({ id }) => {
        this.imageIds.set([id]);
        this.photoState.set('done');
      },
      error: (err) => {
        this.photoState.set('error');
        this.notificationService.showHttpError(err, 'ai.photo.upload_failed');
      },
    });
  }

  /** Store the photo AND propose the catalogue entry it shows. Nothing is saved until the person saves. */
  private analysePhoto(file: File): void {
    this.photoState.set('analysing');
    this.suggestion.set(null);
    this.ai.suggestProductFromImage(file).subscribe({
      next: (suggestion) => {
        this.imageIds.set([suggestion.imageId]);
        this.suggestion.set(suggestion);
        this.photoState.set('done');
        if (!suggestion.isProductPhoto) {
          this.notificationService.showWarning('ai.photo.not_a_product');
          return;
        }
        this.applySuggestion(suggestion);
      },
      error: (err) => {
        //  The form works by hand exactly as before; the photo is still stored if it can be.
        this.photoState.set('error');
        this.notificationService.showHttpError(err, 'ai.photo.analysis_failed');
        this.storePhoto(file);
      },
    });
  }

  private applyingSuggestion = false;

  /**
   * Fill the fields the person has not touched. A value already typed is never overwritten — the
   * suggestion is help, not authority — and a barcode that failed its check digit is left out.
   */
  private applySuggestion(s: ProductSuggestion): void {
    const filled: Record<string, number> = {};
    const set = (field: string, value: unknown, confidence: number) => {
      const control = this.productForm.get(field);
      if (!control || control.dirty || control.disabled || value === null || value === undefined || value === '') return;
      control.setValue(value);
      filled[field] = confidence;
    };

    this.applyingSuggestion = true;
    try {
      set('name', s.name.value, s.name.confidence);
      set('description', s.description.value, s.description.confidence);
      set('brand', s.brand.value, s.brand.confidence);
      if (s.barcode.check !== 'invalid') set('barcode', s.barcode.value, s.barcode.confidence);
      if (s.categoryId.value && this.categories().some((c) => c.id === s.categoryId.value)) {
        set('categoryId', s.categoryId.value, s.categoryId.confidence);
      }
      set('kind', s.kind.value, s.kind.confidence);
      if (this.unitOptions().some((u) => u.symbol === s.unitOfMeasure.value)) {
        set('unitOfMeasure', s.unitOfMeasure.value, s.unitOfMeasure.confidence);
      }
      set('taxTreatment', s.taxTreatment.value, s.taxTreatment.confidence);
      if (s.taxTreatment.value === 'TAXED' && s.taxRate > 0 && this.taxRates().includes(s.taxRate)) {
        set('taxRate', s.taxRate, s.taxTreatment.confidence);
      }
    } finally {
      this.applyingSuggestion = false;
    }
    if (!this.attributes().length) {
      this.attributes.set(Object.entries(s.attributes).map(([key, value]) => ({ key, value })));
    }
    // The maker, when the label names one, is kept as an attribute: the catalogue has no column
    // for it, and it is what a buyer searches by when the brand is a distributor's.
    if (s.manufacturer.value) this.addAttribute(this.translate.instant('ai.product.manufacturer_attribute'), s.manufacturer.value);
    this.suggested.set(filled);
    if (Object.keys(filled).length) this.productForm.markAsDirty();
  }

  /** The model's confidence in a field it filled, or null when the field is the person's own. */
  confidenceOf(field: string): number | null {
    return this.suggested()[field] ?? null;
  }

  /**
   * A price from the tenant's own numbers: the cost entered, times the median markup of the
   * category's products. Never from the model.
   */
  readonly suggestedPrice = computed(() => {
    const markup = this.suggestion()?.pricing.typicalMarkup;
    const cost = Number(this.costValue());
    return markup && cost > 0 ? Math.round(cost * markup * 100) / 100 : null;
  });
  private readonly costValue = signal<number>(0);
  private readonly priceValue = signal<number>(0);

  applySuggestedPrice(): void {
    const price = this.suggestedPrice();
    if (price !== null) {
      this.productForm.get('price')?.setValue(price);
      this.productForm.get('price')?.markAsDirty();
    }
  }

  addAttribute(key: string, value: string): void {
    const k = key.trim().slice(0, 40);
    const v = value.trim().slice(0, 120);
    if (!k || !v) return;
    this.attributes.update((list) => [...list.filter((a) => a.key !== k), { key: k, value: v }].slice(0, 20));
    this.productForm.markAsDirty();
  }

  removeAttribute(key: string): void {
    this.attributes.update((list) => list.filter((a) => a.key !== key));
    this.productForm.markAsDirty();
  }

  /** A barcode read by the camera (or typed in the scanner): what is it? */
  onScanned(code: string): void {
    this.scanning.set(false);
    const control = this.productForm.get('barcode');
    if (control && !control.disabled) {
      control.setValue(code);
      control.markAsDirty();
    }
    this.ai.lookupBarcode(code).subscribe({
      next: (lookup) => {
        this.scanMatches.set(lookup.existing);
        if (lookup.check === 'invalid') this.notificationService.showWarning('ai.scan.check_failed');
        this.reference.set(lookup.reference);
        if (lookup.reference) this.applyReference(lookup.reference);
      },
      // The code is in the field either way; what is known about it is a bonus.
      error: () => this.scanMatches.set([]),
    });
  }

  /** Fill only what the person has not typed, from a public reference they are shown and can check. */
  private applyReference(reference: ExternalProductReference): void {
    for (const [field, value] of [['name', reference.name], ['brand', reference.brand]] as const) {
      const control = this.productForm.get(field);
      if (value && control && !control.dirty && !control.value) {
        control.setValue(value);
        control.markAsDirty();
      }
    }
    if (reference.quantity && !this.attributes().some((a) => a.value === reference.quantity)) {
      this.addAttribute(this.translate.instant('ai.product.quantity_attribute'), reference.quantity);
    }
  }

  cancel(): void {
    void this.router.navigate(['/inventory/products']);
  }

  /** Stock as loaded: it is shown, never edited here. */
  readonly onHand = signal<number | null>(null);

  /** The kardex of this product, and a new adjustment for it — where its stock is changed. */
  protected readonly kardexLink = computed(() => this.organization.urlFor('/inventory/movements'));
  protected readonly adjustLink = computed(() => this.organization.urlFor('/inventory/adjustments/new'));

  saveProduct(): void {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      this.problems.set(
        draftProblems(this.productForm, {
          name: 'inventory.product_form.product_name',
          sku: 'inventory.product_form.sku_product_code',
          description: 'inventory.product_form.description',
          price: 'inventory.product_form.sale_price',
          cost: 'inventory.product_form.unit_cost',
          stock: 'inventory.product_form.quantity_stock',
          reorderLevel: 'inventory.product_form.reorder_level',
          categoryId: 'inventory.product_form.category',
          status: 'inventory.product_form.status',
        }),
      );
      return;
    }

    this.problems.set([]);

    const formValue = this.productForm.getRawValue();
    const productId = this.id();
    formValue.attributes = this.attributes().length
      ? Object.fromEntries(this.attributes().map((a) => [a.key, a.value]))
      : null;
    if (!productId && this.imageIds().length) formValue.imageIds = this.imageIds();

    //  What is held is changed by documents — adjustments, transfers, sales, receipts — never by
    //  editing the product; neither is the cost of stock already held.
    if (productId) {
      delete (formValue as { stock?: unknown }).stock;
      delete (formValue as { warehouseId?: unknown }).warehouseId;
      if (this.productForm.get('cost')?.disabled) delete (formValue as { cost?: unknown }).cost;
    } else if (!formValue.warehouseId) {
      delete (formValue as { warehouseId?: unknown }).warehouseId;
    }

    this.isLoading.set(true);

    const operation = productId
      ? this.inventoryService.updateProduct(productId, formValue as UpdateProductDto)
      : this.inventoryService.createProduct(formValue as CreateProductDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'inventory.product_form.product_updated' : 'inventory.product_form.product_created');
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/inventory/products']).then(() => this.tab?.close());
      },
      error: (err) => {
        //  El motivo real —SKU repetido, nombre de más de 255 caracteres— y no un «Error al crear
        //  el producto» que no dice qué corregir (QA A-17).
        this.notificationService.showHttpError(
          err,
          this.isEditMode() ? 'inventory.product_form.error_updating_product' : 'inventory.product_form.error_creating_product',
        );
        this.isLoading.set(false);
      }
    });
  }
}

/** The fields a photo can fill. */
const SUGGESTIBLE_FIELDS = [
  'name',
  'description',
  'brand',
  'barcode',
  'categoryId',
  'kind',
  'unitOfMeasure',
  'taxTreatment',
  'taxRate',
] as const;
