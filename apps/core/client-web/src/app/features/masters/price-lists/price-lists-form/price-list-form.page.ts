import { Component, ChangeDetectionStrategy, inject, OnInit, signal, input, effect } from '@angular/core';
import { Router } from '@angular/router';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, Save, Plus, Trash2 } from 'lucide-angular';
import { PriceListsService, CreatePriceListDto, UpdatePriceListDto } from '../../../../core/api/price-lists.service';
import { InventoryService } from '../../../../core/api/inventory.service';
import { NotificationService } from '../../../../core/services/notification';
import { Product } from '../../../../core/models/product.model';
import { PriceListItem, PriceListStatus } from '../../../../core/models/price-list.model';
import { TranslateModule } from '@ngx-translate/core';
import { DraftShellComponent, DraftProblem, draftProblems } from '../../../../shared/components/gestures';
import { TAB_CONTEXT } from '../../../../core/tabs/tab-context';

@Component({
  selector: 'app-price-list-form-page',
  imports: [ReactiveFormsModule, LucideAngularModule, TranslateModule, DraftShellComponent],
  templateUrl: './price-list-form.page.html',
  styleUrls: ['./price-list-form.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceListFormPage implements OnInit {
  /** La ventana que hospeda esta página, cuando la hay. Nula si la monta el router. */
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  id = input<string>();

  private fb = inject(FormBuilder);
  private router = inject(Router);
  // private route = inject(ActivatedRoute);
  private priceListsService = inject(PriceListsService);
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);

  protected readonly PlusIcon = Plus;
  protected readonly TrashIcon = Trash2;

  readonly problems = signal<DraftProblem[]>([]);

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
      error: () => this.notificationService.showError('masters.price_lists_form.products_could_not_loaded'),
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
        this.notificationService.showError('masters.price_lists_form.price_list_could_not_loaded');
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

  cancel(): void {
    void this.router.navigate(['/masters/price-lists']);
  }

  savePriceList(): void {
    if (this.priceListForm.invalid) {
      this.priceListForm.markAllAsTouched();
      //  Con veinte líneas de precio, la que falla puede estar fuera de la pantalla: el resumen
      //  entra en el `FormArray` y nombra la línea concreta.
      this.problems.set(
        draftProblems(this.priceListForm, {
          name: 'masters.price_lists_form.list_name',
          status: 'masters.price_lists_form.status',
          currency: 'masters.price_lists_form.currency',
          validFrom: 'masters.price_lists_form.valid_from',
          validTo: 'masters.price_lists_form.valid_until',
          items: 'masters.price_lists_form.price_list_items',
          productId: 'masters.price_lists_form.product',
          price: 'masters.price_lists_form.price',
        }),
      );
      return;
    }

    this.problems.set([]);

    if (this.isSaving()) return;
    this.isSaving.set(true);
    
    const formValue = this.priceListForm.getRawValue();

    const priceListId = this.id();
    const operation = priceListId
      ? this.priceListsService.updatePriceList(priceListId, formValue as UpdatePriceListDto)
      : this.priceListsService.createPriceList(formValue as CreatePriceListDto);

    operation.subscribe({
      next: () => {
        this.notificationService.showSuccess(this.isEditMode() ? 'masters.price_lists_form.price_list_updated' : 'masters.price_lists_form.price_list_created');
        //  Esta ventana ya cumplió: el registro existe y la página se va a la lista. Si se dejara
        //  abierta seguiría anunciándose como «el formulario nuevo», y el siguiente clic en «Nuevo»
        //  la enfocaría con el documento ya guardado dentro. Ver `TabContext.close`.
        void this.router.navigate(['/masters/price-lists']).then(() => this.tab?.close());
      },
      error: (err) => {
        this.notificationService.showError(this.isEditMode() ? 'masters.price_lists_form.error_updating_price_list' : 'masters.price_lists_form.error_creating_price_list');
        this.isSaving.set(false);
      },
      complete: () => {
        this.isSaving.set(false);
      }
    });
  }
}
