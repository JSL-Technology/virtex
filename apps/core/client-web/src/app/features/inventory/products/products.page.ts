import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, MoreHorizontal, AlertCircle, Search, Pencil, Trash2 } from 'lucide-angular';
// import { Product } from '../../../core/models/product.model';
import { InventoryService } from '../../../core/api/inventory.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Product } from '../../../core/models/product.model';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-products-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, HasPermissionDirective, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsPage implements OnInit {
  private readonly dialog = inject(DialogService);
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);

  // Iconos
  protected readonly PlusCircleIcon = PlusCircle;
  // La plantilla usa estos dos en cada fila; sin declararlos, `[img]` recibía undefined
  // y `lucide-icon` lanzaba «No icon name or image has been provided» por cada producto.
  protected readonly EditIcon = Pencil;
  protected readonly TrashIcon = Trash2;

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
        this.error.set('INVENTORY.PRODUCTS.LOAD_FAILED');
        this.isLoading.set(false);
        this.notificationService.showError(this.error()!);
      }
    });
  }


  getStockStatusClass(product: Product): string {
    if (product.status === 'Inactive') return 'status-inactive';
    if (product.stock === 0) return 'status-out';
    if (product.reorderLevel && product.stock <= product.reorderLevel) return 'status-low';
    return 'status-active';
  }

  async deleteProduct(product: Product): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_PRODUCT.TITLE',
      message: 'DIALOG.DELETE_PRODUCT.MESSAGE',
      messageParams: { name: product.name },
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (confirmed) {
      this.inventoryService.deleteProduct(product.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('INVENTORY.PRODUCTS.PRODUCTO_ELIMINADO_EXITOSAMENTE');
          this.loadProducts(); // Recargar la lista
        },
        error: () => this.notificationService.showError('INVENTORY.PRODUCTS.ERROR_ELIMINAR_PRODUCTO')
      });
    }
  }

}
