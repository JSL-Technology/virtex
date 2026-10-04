import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { InvoicesService } from '../../../core/services/invoices';
import { DialogService } from '../../../core/services/dialog.service';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Image } from 'lucide-angular';
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
  imports: [ReactiveFormsModule, LucideAngularModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y, ...FORMAT_PIPES],
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
  private readonly dialog = inject(DialogService);

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
    this.productForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(255)]],
      sku: [''],
      description: [''],
      categoryId: [null],
      price: [0, [Validators.required, Validators.min(0)]],
      cost: [0, [Validators.min(0)]],
      stock: [0, [Validators.required, Validators.min(0)]],
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
        this.original = { stock: Number(product.stock ?? 0), cost: Number(product.cost ?? 0) };
        //  Las existencias no se editan como un campo más (QA M-08): cambiarlas aquí contabilizaba
        //  en silencio un ajuste de inventario —571.800 en la prueba— sin motivo ni confirmación.
        //  Se ajustan con «Ajustar existencias», que pide ambos.
        this.productForm.get('stock')?.disable({ emitEvent: false });
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

  /** Stock and cost as loaded, to tell an adjustment from an ordinary edit. */
  private original: { stock: number; cost: number } | null = null;

  /**
   * Adjust what is on hand, deliberately.
   *
   * A count that disagrees with the record, breakage, a theft: each moves inventory against the
   * adjustment account and changes the balance sheet. It asks for the new quantity and the reason,
   * shows the value it will post, and records the reason on the entry and the stock ledger.
   */
  async adjustStock(): Promise<void> {
    const productId = this.id();
    if (!productId || !this.original) return;
    const next = await this.dialog.prompt({
      title: 'inventory.product_form.adjust_stock_title',
      message: 'inventory.product_form.adjust_stock_message',
      messageParams: { current: this.original.stock },
      placeholder: 'inventory.product_form.adjust_stock_quantity',
      minLength: 1,
      tooShort: 'inventory.product_form.adjust_stock_quantity',
    });
    if (next === null || next === undefined || next === '') return;
    const quantity = Number(String(next).replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity < 0) {
      this.notificationService.showError('inventory.product_form.adjust_stock_invalid');
      return;
    }
    const cost = Number(this.productForm.get('cost')?.value ?? this.original.cost);
    const delta = Math.round((quantity - this.original.stock) * cost * 100) / 100;
    const reason = await this.dialog.prompt({
      title: 'inventory.product_form.adjust_stock_reason_title',
      message: 'inventory.product_form.adjust_stock_reason_message',
      messageParams: { from: this.original.stock, to: quantity, value: delta },
      placeholder: 'inventory.product_form.adjust_stock_reason_placeholder',
      minLength: 5,
      tooShort: 'inventory.product_form.adjust_stock_reason_too_short',
      variant: 'warning',
    });
    if (!reason) return;

    this.isLoading.set(true);
    this.inventoryService
      .updateProduct(productId, { stock: quantity, adjustmentReason: reason } as UpdateProductDto)
      .subscribe({
        next: (product) => {
          this.isLoading.set(false);
          this.original = { stock: Number(product.stock ?? quantity), cost: Number(product.cost ?? cost) };
          this.productForm.get('stock')?.setValue(this.original.stock, { emitEvent: false });
          this.notificationService.showSuccess('inventory.product_form.stock_adjusted');
        },
        error: (err) => {
          this.isLoading.set(false);
          this.notificationService.showHttpError(err, 'inventory.product_form.error_updating_product');
        },
      });
  }

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

    //  Changing the unit cost on an existing product revalues what is on hand: ask why, and say
    //  what it will post, instead of doing it silently (QA M-08).
    if (productId && this.original && Number(formValue.cost) !== this.original.cost && this.original.stock !== 0) {
      void this.confirmRevaluation(productId, formValue);
      return;
    }
    //  Stock is adjusted through its own action; an edit never carries it.
    if (productId) delete (formValue as { stock?: unknown }).stock;

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

  private async confirmRevaluation(productId: string, formValue: Record<string, unknown>): Promise<void> {
    const cost = Number(formValue['cost']);
    const delta = Math.round(this.original!.stock * (cost - this.original!.cost) * 100) / 100;
    const reason = await this.dialog.prompt({
      title: 'inventory.product_form.revalue_title',
      message: 'inventory.product_form.revalue_message',
      messageParams: { from: this.original!.cost, to: cost, value: delta },
      placeholder: 'inventory.product_form.adjust_stock_reason_placeholder',
      minLength: 5,
      tooShort: 'inventory.product_form.adjust_stock_reason_too_short',
      variant: 'warning',
    });
    if (!reason) return;
    const { stock: _stock, ...rest } = formValue as { stock?: unknown } & Record<string, unknown>;
    this.isLoading.set(true);
    this.inventoryService
      .updateProduct(productId, { ...rest, adjustmentReason: reason } as UpdateProductDto)
      .subscribe({
        next: () => {
          this.notificationService.showSuccess('inventory.product_form.product_updated');
          void this.router.navigate(['/inventory/products']).then(() => this.tab?.close());
        },
        error: (err) => {
          this.isLoading.set(false);
          this.notificationService.showHttpError(err, 'inventory.product_form.error_updating_product');
        },
      });
  }
}
