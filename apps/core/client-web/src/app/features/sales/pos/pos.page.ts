import { Component, ChangeDetectionStrategy, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Search, X, Plus, Minus, Trash2, CreditCard } from 'lucide-angular';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Product } from '../../../core/models/product.model';

// Reutilizamos el modelo de producto
// import { Product } from '../../inventory/products/products.page';

@Component({
  selector: 'app-pos-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule],
  templateUrl: './pos.page.html',
  styleUrls: ['./pos.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosPage implements OnInit {
  private fb = inject(FormBuilder);

  protected readonly SearchIcon = Search;
  protected readonly XIcon = X;
  protected readonly PlusIcon = Plus;
  protected readonly MinusIcon = Minus;
  protected readonly TrashIcon = Trash2;
  protected readonly CreditCardIcon = CreditCard;

  // Catálogo de productos simulado
  allProducts = signal<Product[]>([
    // { id: 'P001', name: 'Laptop Pro 15"', sku: 'LP-15-PRO', category: 'Electrónica', price: 1599.99, stock: 25, status: 'En Stock', imageUrl: 'https://i.imgur.com/4q0d7w9.png' },
    // { id: 'P002', name: 'Mouse Inalámbrico Ergonómico', sku: 'MS-ERG-WL', category: 'Accesorios', price: 49.50, stock: 8, status: 'Bajo Stock', imageUrl: 'https://i.imgur.com/h3G6Qv4.png' },
    // { id: 'P003', name: 'Teclado Mecánico RGB', sku: 'KB-MEC-RGB', category: 'Accesorios', price: 120.00, stock: 0, status: 'Agotado', imageUrl: 'https://i.imgur.com/a9a626d.png' },
    // { id: 'P004', name: 'Monitor UltraWide 34"', sku: 'MN-UW-34', category: 'Monitores', price: 799.00, stock: 15, status: 'En Stock', imageUrl: 'https://i.imgur.com/L30ER72.png' },
  ]);

  saleForm!: FormGroup;

  private formChanges = toSignal(this.saleForm.valueChanges, { initialValue: {} });

  subtotal = computed(() => {
    return this.cartItems.controls.reduce((acc, control) => {
      const quantity = control.get('quantity')?.value || 0;
      const price = control.get('price')?.value || 0;
      return acc + (quantity * price);
    }, 0);
  });

  taxAmount = computed(() => this.subtotal() * 0.18);
  total = computed(() => this.subtotal() + this.taxAmount());

  ngOnInit(): void {
    this.saleForm = this.fb.group({
      cartItems: this.fb.array([]),
      customer: ['Cliente General'],
    });
  }

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