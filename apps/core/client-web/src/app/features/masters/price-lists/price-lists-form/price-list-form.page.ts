import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Plus, Trash2 } from 'lucide-angular';
import { PriceListsService, CreatePriceListDto, UpdatePriceListDto } from '../../../../core/api/price-lists.service';
import { InventoryService } from '../../../../core/api/inventory.service';
import { NotificationService } from '../../../../core/services/notification';
import { Product } from '../../../../core/models/product.model';
import { PriceListItem, PriceListStatus } from '../../../../core/models/price-list.model';

@Component({
  selector: 'app-price-list-form-page',
  imports: [RouterLink, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './price-list-form.page.html',
  styleUrls: ['./price-list-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceListFormPage implements OnInit {
  id = input<string>();

  private fb = inject(FormBuilder);
  private router = inject(Router);
  // private route = inject(ActivatedRoute);
  private priceListsService = inject(PriceListsService);
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);

  protected readonly SaveIcon = Save;
  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;

  priceListForm!: FormGroup;
  isEditMode = signal(false);
  isLoading = signal(true);
  isSaving = signal(false);
  products = signal<Product[]>([]);
  private priceListId: string | null = null;

  statusOptions: PriceListStatus[] = [PriceListStatus.DRAFT, PriceListStatus.ACTIVE, PriceListStatus.INACTIVE];

  constructor() {
    effect(() => {
      const idValue = this.id();
      if (idValue) {
        this.isEditMode.set(true);
        this.loadPriceListData(idValue);
      } else {
        this.isEditMode.set(false);
        this.isLoading.set(false);
        if (this.lines.length === 0) {
            this.addLine();
        }
      }
    });
  }

  ngOnInit(): void {
    const today = new Date().toISOString().split('T')[0];
    this.priceListForm = this.fb.group({
      name: ['', Validators.required],
      currency: ['USD', Validators.required],
      validFrom: [today, Validators.required],
      validTo: [today, Validators.required],
      status: [PriceListStatus.DRAFT, Validators.required],
      items: this.fb.array([], [Validators.required, Validators.minLength(1)]),
    });

    this.loadProducts();
  }

  loadProducts(): void {
    this.inventoryService.getProducts().subscribe({
      next: (products) => this.products.set(products),
      error: () => this.notificationService.showError('No se pudieron cargar los productos.'),
    });
  }

  loadPriceListData(id: string): void {
    this.isLoading.set(true);
    this.priceListsService.getPriceListById(id).subscribe({
      next: (priceList) => {
        this.priceListForm.patchValue({
          ...priceList,
          validFrom: new Date(priceList.validFrom).toISOString().split('T')[0],
          validTo: new Date(priceList.validTo).toISOString().split('T')[0],
        });
        
        this.lines.clear();
        priceList.items.forEach((item: PriceListItem) => {
            this.lines.push(this.createLine(item.productId, item.price));
        });

        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('No se pudo cargar la lista de precios.');
        this.router.navigate(['/masters/price-lists']);
      },
    });
  }

  get lines(): FormArray {
    return this.priceListForm.get('items') as FormArray;
  }

  createLine(productId = '', price = 0): FormGroup {
    return this.fb.group({
      productId: [productId, Validators.required],
      price: [price, [Validators.required, Validators.min(0.01)]],
    });
  }

  addLine(): void {
    this.lines.push(this.createLine());
  }

  removeLine(index: number): void {
    if (this.lines.length > 1) {
        this.lines.removeAt(index);
    }
  }

  savePriceList(): void {
    if (this.priceListForm.invalid) {
      this.priceListForm.markAllAsTouched();
      this.notificationService.showError('Por favor, completa los campos requeridos.');
      return;
    }

    if (this.isSaving()) return;
    this.isSaving.set(true);
    
    const formValue = this.priceListForm.getRawValue();

    const priceListId = this.id();
    const operation = priceListId
      ? this.priceListsService.updatePriceList(priceListId, formValue as UpdatePriceListDto)
      : this.priceListsService.createPriceList(formValue as CreatePriceListDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(`Lista de precios ${this.isEditMode() ? 'actualizada' : 'creada'} exitosamente.`);
        this.router.navigate(['/masters/price-lists']);
      },
      error: (err) => {
        this.notificationService.showError(`Error al ${this.isEditMode() ? 'actualizar' : 'crear'} la lista de precios.`);
        this.isSaving.set(false);
      },
      complete: () => {
        this.isSaving.set(false);
      }
    });
  }
}
