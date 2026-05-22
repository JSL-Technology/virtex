import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, MoreHorizontal, AlertCircle, Search } from 'lucide-angular';
// import { Product } from '../../../core/models/product.model';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Product } from '../../../core/models/product.model';

@Component({
  selector: 'app-products-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, HasPermissionDirective],
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsPage implements OnInit {
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);
  private router = inject(Router);

  // Iconos
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly SearchIcon = Search;

  // Estado con Signals
  private allProducts = signal<Product[]>([]);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  searchTerm = signal<string>('');

  // Productos filtrados para mostrar en la tabla
  filteredProducts = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) {
      return this.allProducts();
    }
    return this.allProducts().filter(p =>
      p.name.toLowerCase().includes(term) ||
      p.sku?.toLowerCase().includes(term) ||
      p.category?.toLowerCase().includes(term)
    );
  });

  ngOnInit(): void {
    this.loadProducts();
  }

  loadProducts(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.inventoryService.getProducts().subscribe({
      next: (products) => {
        this.allProducts.set(products);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('No se pudieron cargar los productos. Por favor, intente de nuevo.');
        this.isLoading.set(false);
        this.notificationService.showError(this.error()!);
      }
    });
  }

  onSearch(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.searchTerm.set(term);
  }

  getStockStatusClass(product: Product): string {
    if (product.status === 'Inactive') return 'status-inactive';
    if (product.stock === 0) return 'status-out';
    if (product.reorderLevel && product.stock <= product.reorderLevel) return 'status-low';
    return 'status-active';
  }

  deleteProduct(product: Product): void {
    if (confirm(`¿Estás seguro de que quieres eliminar el producto "${product.name}"?`)) {
      this.inventoryService.deleteProduct(product.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('Producto eliminado exitosamente.');
          this.loadProducts(); // Recargar la lista
        },
        error: () => this.notificationService.showError('Error al eliminar el producto.')
      });
    }
  }

  navigateToEdit(productId: string): void {
    this.router.navigate(['/inventory/products', productId, 'edit']);
  }
}
