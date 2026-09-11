import { Component, ChangeDetectionStrategy, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Search, X, Plus, Minus, Trash2, CreditCard, ShoppingCart } from 'lucide-angular';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Product } from '../../../core/models/product.model';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { InvoicesService } from '../../../core/services/invoices';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { PosService } from './pos.service';

// Reutilizamos el modelo de producto
// import { Product } from '../../inventory/products/products.page';

@Component({
  selector: 'app-pos-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosPage {
  private fb = inject(FormBuilder);
  private readonly invoicesService = inject(InvoicesService);
  private readonly inventoryService = inject(InventoryService);
  private readonly posService = inject(PosService);
  private readonly notifications = inject(NotificationService);

  /**
   * The till this screen operates. Single-terminal for now; multi-terminal is a matter of letting
   * the operator pick one and threading it through, not of the sale path, which is already keyed by
   * it end to end (shift lookup, sale record, stock movement).
   */
  private readonly terminalId = 'main';

  /** The open shift this screen is ringing sales into, if any. */
  readonly activeShiftId = signal<string | null>(null);
  readonly saving = signal(false);

  /**
   * The market's own invoicing context: currency, and the rates it levies.
   *
   * The tax rate used to be `const POS_TAX_RATE = 0.18` — the Dominican ITBIS, applied to a
   * Mexican tenant's till at 16 %, to a United States one that has no national rate at all, and
   * printed on the ticket as the literal label "Impuestos (18%)". `InvoicesService.context()`
   * already answers this per tenant and is what the invoice form uses; the till now asks the same
   * question rather than assuming the answer.
   */
  private readonly context = toSignal(this.invoicesService.context(), { initialValue: null });

  /** The market's standard rate, as a fraction. Zero where the tenant has yet to configure one. */
  readonly taxRate = computed(() => this.context()?.taxRates?.[0] ?? 0);
  readonly currencyCode = computed(() => this.context()?.baseCurrency ?? null);
  /** True where the rate is sub-national (US, Brazil) and cannot be assumed from the country. */
  readonly taxNeedsConfiguration = computed(
    () => this.context()?.taxRequiresConfiguration === true,
  );

  protected readonly SearchIcon = Search;
  protected readonly XIcon = X;
  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly TrashIcon = Trash2;
  protected readonly CreditCardIcon = CreditCard;
  // The empty-cart illustration referenced this by string name (`name="shopping-cart"`), which
  // only works when the icon set is registered globally — it is not, so the icon never rendered.
  protected readonly ShoppingCartIcon = ShoppingCart;

  // Catálogo de productos simulado
  allProducts = signal<Product[]>([
    // { id: 'P001', name: 'Laptop Pro 15"', sku: 'LP-15-PRO', category: 'Electrónica', price: 1599.99, stock: 25, status: 'En Stock', imageUrl: 'https://i.imgur.com/4q0d7w9.png' },
    // { id: 'P002', name: 'Mouse Inalámbrico Ergonómico', sku: 'MS-ERG-WL', category: 'Accesorios', price: 49.50, stock: 8, status: 'Bajo Stock', imageUrl: 'https://i.imgur.com/h3G6Qv4.png' },
    // { id: 'P003', name: 'Teclado Mecánico RGB', sku: 'KB-MEC-RGB', category: 'Accesorios', price: 120.00, stock: 0, status: 'Agotado', imageUrl: 'https://i.imgur.com/a9a626d.png' },
    // { id: 'P004', name: 'Monitor UltraWide 34"', sku: 'MN-UW-34', category: 'Monitores', price: 799.00, stock: 15, status: 'En Stock', imageUrl: 'https://i.imgur.com/L30ER72.png' },
  ]);

  /**
   * Built in the field initializer, not in `ngOnInit`.
   *
   * `formChanges` below reads `saleForm.valueChanges` while the class fields are initialising,
   * which runs before any lifecycle hook — so with the form created in `ngOnInit` the component
   * threw "Cannot read properties of undefined (reading 'valueChanges')" the moment it was
   * constructed. The point of sale did not open at all.
   */
  saleForm: FormGroup = this.fb.group({
    cartItems: this.fb.array([]),
    customer: ['Cliente General'],
  });

  /**
   * Reactive-forms controls are not signals, so a `computed()` that walks `cartItems.controls`
   * has nothing to depend on and never recomputes: the totals stayed at zero however many items
   * were added. Mirroring the form's value into a signal gives the computations a real
   * dependency.
   */
  private readonly formValue = toSignal(this.saleForm.valueChanges, {
    initialValue: this.saleForm.getRawValue(),
  });

  subtotal = computed(() => {
    const items = (this.formValue()?.cartItems ?? []) as Array<{ quantity?: number; price?: number }>;
    return items.reduce((acc, item) => acc + (item.quantity || 0) * (item.price || 0), 0);
  });

  taxAmount = computed(() => this.subtotal() * this.taxRate());
  total = computed(() => this.subtotal() + this.taxAmount());

  get cartItems(): FormArray {
    return this.saleForm.get('cartItems') as FormArray;
  }

  addToCart(product: Product): void {
    const existingItem = this.cartItems.controls.find(
      (control) => control.get('productId')?.value === product.id
    );
    if (existingItem) {
      existingItem.get('quantity')?.setValue(existingItem.get('quantity')?.value + 1);
    } else {
      const newItem = this.fb.group({
        productId: [product.id],
        name: [product.name],
        price: [product.price],
        quantity: [1],
      });
      this.cartItems.push(newItem);
    }
  }

  updateQuantity(index: number, change: number): void {
    const item = this.cartItems.at(index);
    const newQuantity = (item.get('quantity')?.value || 0) + change;
    if (newQuantity > 0) {
      item.get('quantity')?.setValue(newQuantity);
    } else {
      this.cartItems.removeAt(index);
    }
  }

  removeItem(index: number): void {
    this.cartItems.removeAt(index);
  }

  getItemTotal(item: any): number {
    return (item.get('quantity')?.value || 0) * (item.get('price')?.value || 0);
  }

  constructor() {
    this.loadProducts();
    this.ensureShift();
  }

  /** Fill the till catalogue from the tenant's own inventory — only sellable, in-stock items. */
  private loadProducts(): void {
    this.inventoryService.getProducts().subscribe({
      next: (products) =>
        this.allProducts.set(products.filter((p) => p.status === 'Active')),
      error: () => this.notifications.showError('POS.LOAD_PRODUCTS_ERROR'),
    });
  }

  /**
   * A sale needs an open shift. Rather than make the operator open one by hand before the first
   * sale, adopt the terminal's active shift if there is one and open a zero-float shift otherwise —
   * the backend rejects a second open shift per terminal, so this is idempotent under a refresh.
   */
  private ensureShift(): void {
    this.posService.getActiveShift(this.terminalId).subscribe({
      next: (shift) => {
        if (shift) {
          this.activeShiftId.set(shift.id);
        } else {
          this.posService.openShift(this.terminalId, 0).subscribe({
            next: (opened) => this.activeShiftId.set(opened.id),
            error: () => void 0,
          });
        }
      },
      error: () => void 0,
    });
  }

  completeSale(): void {
    if (this.saving() || this.saleForm.invalid || this.cartItems.length === 0) return;

    const items = (this.cartItems.getRawValue() as Array<{
      productId: string;
      name: string;
      price: number;
      quantity: number;
    }>).map((i) => ({
      productId: i.productId,
      productName: i.name,
      price: i.price,
      quantity: i.quantity,
    }));

    this.saving.set(true);
    this.posService
      .processSale({
        terminalId: this.terminalId,
        items,
        subtotal: this.subtotal(),
        tax: this.taxAmount(),
        total: this.total(),
        customerName: this.saleForm.get('customer')?.value ?? undefined,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.cartItems.clear();
          this.notifications.showSuccess('POS.SALE_COMPLETED');
          // Reflect the stock the sale consumed.
          this.loadProducts();
        },
        error: (err) => {
          this.saving.set(false);
          const message = err?.error?.message;
          this.notifications.showError(typeof message === 'string' ? message : 'POS.SALE_ERROR');
        },
      });
  }
}