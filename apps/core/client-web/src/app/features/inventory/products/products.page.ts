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
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';

@Component({
  selector: 'app-products-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, HasPermissionDirective, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent],
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
      p.category?.name?.toLowerCase().includes(term)
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
        this.error.set('inventory.products.load_failed');
        this.isLoading.set(false);
        this.notificationService.showError(this.error()!);
      }
    });
  }


  /** Sin existencias es un problema, por debajo del punto de pedido es un aviso. */
  stockTone(product: Product): VxTone {
    if (product.status === 'Inactive') return 'neutral';
    if (product.stock === 0) return 'danger';
    if (product.reorderLevel && product.stock <= product.reorderLevel) return 'warning';
    return 'ok';
  }

  async deleteProduct(product: Product): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_product.title',
      message: 'dialog.delete_product.message',
      messageParams: { name: product.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) {
      this.inventoryService.deleteProduct(product.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('inventory.products.product_deleted');
          this.loadProducts(); // Recargar la lista
        },
        error: () => this.notificationService.showError('inventory.products.error_deleting_product')
      });
    }
  }

}
