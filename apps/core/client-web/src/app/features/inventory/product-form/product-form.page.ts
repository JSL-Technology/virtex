import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Image } from 'lucide-angular';
import { InventoryService, CreateProductDto, UpdateProductDto } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

@Component({
  selector: 'app-product-form-page',
  imports: [RouterLink, ReactiveFormsModule, LucideAngularModule, HasPermissionDirective],
  templateUrl: './product-form.page.html',
  styleUrls: ['./product-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductFormPage implements OnInit {
  id = input<string>();

  private fb = inject(FormBuilder);
  private router = inject(Router);
  // private route = inject(ActivatedRoute);
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;
  protected readonly ImageIcon = Image;

  productForm!: FormGroup;
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
    this.productForm = this.fb.group({
      name: ['', Validators.required],
      sku: [''],
      description: [''],
      category: [''],
      price: [0, [Validators.required, Validators.min(0)]],
      cost: [0, [Validators.min(0)]],
      stock: [0, [Validators.required, Validators.min(0)]],
      reorderLevel: [0],
      status: ['Active', Validators.required],
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
        this.notificationService.showError('No se pudo cargar el producto.');
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

  saveProduct(): void {
    if (this.productForm.invalid) {
      this.productForm.markAllAsTouched();
      this.notificationService.showError('Por favor, completa los campos requeridos.');
      return;
    }

    this.isLoading.set(true);
    const formValue = this.productForm.getRawValue();

    const productId = this.id();
    const operation = productId
      ? this.inventoryService.updateProduct(productId, formValue as UpdateProductDto)
      : this.inventoryService.createProduct(formValue as CreateProductDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(`Producto ${this.isEditMode() ? 'actualizado' : 'creado'} exitosamente.`);
        this.router.navigate(['/inventory/products']);
      },
      error: (err) => {
        this.notificationService.showError(`Error al ${this.isEditMode() ? 'actualizar' : 'crear'} el producto.`);
        this.isLoading.set(false);
      }
    });
  }
}
