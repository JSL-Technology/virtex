import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
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
  imports: [ReactiveFormsModule, LucideAngularModule, TranslateModule, DraftShellComponent, ...VX_FORM_A11Y],
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
      name: ['', Validators.required],
      sku: [''],
      description: [''],
      categoryId: [null],
      price: [0, [Validators.required, Validators.min(0)]],
      cost: [0, [Validators.min(0)]],
      stock: [0, [Validators.required, Validators.min(0)]],
      reorderLevel: [0],
      status: ['Active', Validators.required],
    });
  }

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

    this.isLoading.set(true);
    const formValue = this.productForm.getRawValue();

    const productId = this.id();
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
        this.notificationService.showError(this.isEditMode() ? 'inventory.product_form.error_updating_product' : 'inventory.product_form.error_creating_product');
        this.isLoading.set(false);
      }
    });
  }
}
