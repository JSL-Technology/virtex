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

  completeSale(): void {
    if (this.saleForm.valid && this.cartItems.length > 0) {
      console.log('Venta completada:', this.saleForm.value);
      // Lógica para enviar al backend y luego limpiar
      this.cartItems.clear();
    }
  }
}