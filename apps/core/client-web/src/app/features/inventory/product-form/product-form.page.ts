import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { InvoicesService } from '../../../core/services/invoices';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Image } from 'lucide-angular';
import { InventoryService, CreateProductDto, UpdateProductDto } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import {
  ProductCategoriesService,
  ProductCategory,
} from '../../../core/api/product-categories.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-product-form-page',
  imports: [ReactiveFormsModule, RouterLink, HasPermissionDirective, LucideAngularModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y, ...FORMAT_PIPES],
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
  private readonly invoices = inject(InvoicesService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly warehousesApi = inject(WarehousesService);

  /** Where the opening stock can go; the field shows only when there is a choice. */
  readonly warehouses = signal<Warehouse[]>([]);

  protected readonly ImageIcon = Image;

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
      //  Tratamiento fiscal y tasa. El formulario no los tenía, así que todo producto nacía
      //  «gravado al 0 %» y el punto de venta cobraba sin impuesto (QA C-08). La tasa se elige de
      //  las que el mercado del inquilino aplica y viaja como fracción (0.18), nunca como 18.
      taxTreatment: ['TAXED'],
      taxRate: [null as number | null],
    });

    this.productForm.get('taxTreatment')?.valueChanges.subscribe((treatment) => {
      const rate = this.productForm.get('taxRate');
      if (treatment !== 'TAXED') rate?.setValue(0, { emitEvent: false });
      else if (!Number(rate?.value)) rate?.setValue(this.taxRates()[0] ?? null, { emitEvent: false });
    });
    this.productForm.get('kind')?.valueChanges.subscribe((kind) => {
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
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => this.imagePreview.set(reader.result);
      reader.readAsDataURL(file);
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
