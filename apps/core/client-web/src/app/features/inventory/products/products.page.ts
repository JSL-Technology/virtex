import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed, effect } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Pencil, Trash2, Archive, Copy, Download, RotateCw, EllipsisVertical } from 'lucide-angular';
import { InventoryService, CreateProductDto } from '../../../core/api/inventory.service';
import { SafeDeleteService } from '../../../core/services/safe-delete.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Product } from '../../../core/models/product.model';

import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { VX_CONTEXT_MENU, ListSelectionService, ListMenuConfig } from '../../../shared/components/context-menu';
import { DatasetExportService } from '../../../core/export/dataset-export';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-products-page',
  standalone: true,
  imports: [RowLinkDirective, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, HasPermissionDirective, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent, ...VX_CONTEXT_MENU],
  providers: [ListSelectionService],
  templateUrl: './products.page.html',
  styleUrls: ['./products.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProductsPage implements OnInit {
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.filteredProducts(), { category: (product) => product.category?.name, status: (product) => (product.status === 'Active' ? (product.stock > 0 ? 0 : 1) : 2) });
  private readonly dialog = inject(DialogService);
  private inventoryService = inject(InventoryService);
  private notificationService = inject(NotificationService);
  private readonly safeDelete = inject(SafeDeleteService);
  private readonly router = inject(Router);
  private readonly datasetExport = inject(DatasetExportService);
  /** Selección múltiple de la lista; alimenta las acciones en lote del menú contextual. */
  readonly selection = inject<ListSelectionService<Product>>(ListSelectionService);

  // Iconos
  protected readonly PlusCircleIcon = PlusCircle;
  // La plantilla usa estos dos en cada fila; sin declararlos, `[img]` recibía undefined
  // y `lucide-icon` lanzaba «No icon name or image has been provided» por cada producto.
  protected readonly EditIcon = Pencil;
  protected readonly TrashIcon = Trash2;
  protected readonly MoreIcon = EllipsisVertical;

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

  constructor() {
    // La selección sigue a lo que se ve: al buscar o recargar, descarta filas que ya no están.
    effect(() => this.selection.setItems(this.filteredProducts(), (p) => p.id));
  }

  /**
   * El menú contextual de la tabla y de cada fila, como DATOS.
   *
   * La tabla ofrece crear/refrescar/exportar; la fila, abrir/duplicar/archivar/eliminar —y, con
   * varias filas marcadas, las versiones en lote con su conteo—. Cada acción declara su permiso, así
   * que el motor oculta lo que el usuario no puede hacer, igual que `*appHasPermission`.
   */
  readonly productsMenu: ListMenuConfig<Product> = {
    resource: 'products',
    table: [
      {
        id: 'crud',
        items: [
          { id: 'new', label: 'inventory.products.new_product', icon: PlusCircle, permission: 'products:create', run: () => this.newProduct() },
          { id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.loadProducts() },
          { id: 'export', label: 'actions.export', icon: Download, run: () => this.datasetExport.export('products') },
        ],
      },
    ],
    row: (ctx) => {
      if (ctx.selection.length > 1) {
        const n = ctx.selection.length;
        const items = ctx.selection as Product[];
        return [
          {
            id: 'bulk',
            items: [
              { id: 'archive', label: () => ({ key: 'actions.archive_n', params: { n } }), icon: Archive, permission: 'products:edit', run: () => this.archiveMany(items) },
              { id: 'delete', label: () => ({ key: 'actions.delete_n', params: { n } }), icon: Trash2, danger: true, permission: 'products:delete', run: () => this.deleteMany(items) },
              { id: 'export', label: () => ({ key: 'actions.export_n', params: { n } }), icon: Download, run: () => this.datasetExport.export('products') },
            ],
          },
        ];
      }
      const product = ctx.entity as Product;
      return [
        {
          id: 'row',
          items: [
            { id: 'edit', label: 'inventory.products.edit', icon: Pencil, permission: 'products:edit', run: () => this.editProduct(product) },
            { id: 'duplicate', label: 'actions.duplicate', icon: Copy, permission: 'products:create', run: () => this.duplicateProduct(product) },
            { id: 'archive', label: 'actions.archive', icon: Archive, permission: 'products:edit', visible: () => product.status === 'Active', run: () => this.archiveProduct(product) },
            { id: 'delete', label: 'inventory.products.delete', icon: Trash2, danger: true, permission: 'products:delete', run: () => this.deleteProduct(product) },
          ],
        },
      ];
    },
  };

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
  /** What the status column says. A service is available while active; it has no stock to run out of. */
  stockLabel(product: Product): string {
    if (product.status !== 'Active') return 'inventory.products.status_inactive';
    if (product.kind === 'SERVICE') return 'inventory.products.service_available';
    return product.stock > 0 ? 'inventory.products.stock_in' : 'inventory.products.stock_out';
  }

  stockTone(product: Product): VxTone {
    if (product.status === 'Inactive') return 'neutral';
    if (product.kind === 'SERVICE') return 'ok';
    if (product.stock === 0) return 'danger';
    if (product.reorderLevel && product.stock <= product.reorderLevel) return 'warning';
    return 'ok';
  }

  protected newProduct(): void {
    void this.router.navigate(['/inventory/products/new']);
  }

  protected editProduct(product: Product): void {
    void this.router.navigate(['/inventory/products', product.id, 'edit']);
  }

  /** Crea una copia editable con existencias en cero: duplicar el catálogo, no el inventario. */
  protected duplicateProduct(product: Product): void {
    const dto: CreateProductDto = {
      name: `${product.name} (copia)`,
      sku: product.sku ? `${product.sku}-COPIA` : undefined,
      description: product.description,
      categoryId: product.categoryId ?? undefined,
      price: product.price,
      cost: product.cost,
      stock: 0,
      reorderLevel: product.reorderLevel,
      status: product.status,
      kind: product.kind,
      unitOfMeasure: product.unitOfMeasure,
      taxTreatment: product.taxTreatment,
      taxRate: product.taxRate,
      exciseRate: product.exciseRate,
      fiscalItemCode: product.fiscalItemCode,
      brand: product.brand,
      attributes: product.attributes,
    };
    this.inventoryService.createProduct(dto).subscribe({
      next: () => { this.notificationService.showSuccess('inventory.products.product_created'); this.loadProducts(); },
      error: (err) => this.notificationService.showHttpError(err, 'inventory.products.error_creating_product'),
    });
  }

  /** Archivar = desactivar: el producto deja de ofrecerse sin perder su historia. */
  protected archiveProduct(product: Product): void {
    this.inventoryService.updateProduct(product.id, { status: 'Inactive' }).subscribe({
      next: () => { this.notificationService.showSuccess('inventory.products.product_deactivated'); this.loadProducts(); },
      error: (err) => this.notificationService.showHttpError(err, 'inventory.products.error_updating_product'),
    });
  }

  protected archiveMany(items: Product[]): void {
    forkJoin(items.map((p) => this.inventoryService.updateProduct(p.id, { status: 'Inactive' }))).subscribe({
      next: () => { this.notificationService.showSuccess('inventory.products.product_deactivated'); this.selection.clear(); this.loadProducts(); },
      error: (err) => this.notificationService.showHttpError(err, 'inventory.products.error_updating_product'),
    });
  }

  protected async deleteMany(items: Product[]): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'actions.delete_selected_title',
      message: 'actions.delete_selected_message',
      messageParams: { n: items.length },
      variant: 'danger',
    });
    if (!confirmed) return;
    forkJoin(items.map((p) => this.inventoryService.deleteProduct(p.id))).subscribe({
      next: () => { this.notificationService.showSuccess('inventory.products.product_deleted'); this.selection.clear(); this.loadProducts(); },
      error: (err) => this.notificationService.showHttpError(err, 'inventory.products.error_deleting_product'),
    });
  }

  /** Deleting asks first what still uses the product, and offers to deactivate it (QA A-08). */
  async deleteProduct(product: Product): Promise<void> {
    const outcome = await this.safeDelete.run({
      name: product.name,
      check: () => this.inventoryService.productDependents(product.id),
      remove: () => this.inventoryService.deleteProduct(product.id),
      deactivate: () => this.inventoryService.updateProduct(product.id, { status: 'Inactive' }),
      keys: {
        confirmTitle: 'dialog.delete_product.title',
        confirmMessage: 'dialog.delete_product.message',
        deleted: 'inventory.products.product_deleted',
        deleteFailed: 'inventory.products.error_deleting_product',
        blockedTitle: 'inventory.products.delete_blocked_title',
        blockedMessage: 'inventory.products.delete_blocked_message',
        deactivated: 'inventory.products.product_deactivated',
      },
    });
    if (outcome !== 'cancelled') this.loadProducts();
  }

}
