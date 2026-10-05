import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VX_SELECT } from '../../../shared/components/select';
import { VxDateRangeComponent } from '../../../shared/components/date';
import { NotificationService } from '../../../core/services/notification';
import { InventoryService } from '../../../core/api/inventory.service';
import { Product } from '../../../core/models/product.model';
import { STOCK_MOVEMENT_TYPES, StockMovementRow, StockMovementType, StockService } from '../data/stock.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';

/** Where a movement's source document opens, when it has a screen of its own. */
const SOURCE_ROUTES: Record<string, (id: string) => string> = {
  invoice: (id) => `/invoices/${id}`,
  credit_note: (id) => `/invoices/${id}`,
  vendor_bill: (id) => `/accounts-payable/${id}`,
  vendor_bill_void: (id) => `/accounts-payable/${id}`,
  inventory_adjustment: (id) => `/inventory/adjustments/${id}`,
  stock_transfer: (id) => `/inventory/transfers/${id}`,
  product_opening: (id) => `/inventory/products/${id}/edit`,
};

/**
 * The kardex: every movement of stock, with the balance after each one.
 *
 * MB51, Inventory Activity Detail, Odoo's moves history — the screen that answers «why does the
 * system say twelve?». Filtered by product and warehouse the balance runs per warehouse; by product
 * alone it runs for the company. A date range starts from what was held before it, so the first
 * row of a month does not pretend the year began with it.
 */
@Component({
  selector: 'app-stock-movements-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ...VX_SELECT, ListShellComponent, VxPagerComponent, VxDateRangeComponent],
  templateUrl: './movements.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './movements.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockMovementsPage implements OnInit {
  private readonly stock = inject(StockService);
  private readonly products = inject(InventoryService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);

  /** From the URL: the stock register and the product form open the kardex already filtered. */
  readonly productId = input<string>();
  readonly warehouseId = input<string>();

  protected readonly types = STOCK_MOVEMENT_TYPES;

  readonly rows = signal<StockMovementRow[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(100);
  readonly openingBalance = signal<number | null>(null);

  readonly productFilter = signal<string | null>(null);
  readonly warehouseFilter = signal<string>('');
  readonly typeFilter = signal<StockMovementType | ''>('');
  readonly from = signal<string | null>(null);
  readonly to = signal<string | null>(null);

  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);
  /** The balance column means something only for one product. */
  readonly showsBalance = computed(() => !!this.productFilter());

  protected readonly searchProducts = (query: string, limit: number): Observable<Product[]> =>
    this.products.searchProducts(query, limit);
  protected readonly resolveProduct = (id: string): Observable<Product> => this.products.getProductById(id);
  protected readonly productName = (product: Product): string => product.name;
  protected readonly productValue = (product: Product): string => product.id;

  ngOnInit(): void {
    this.productFilter.set(this.productId() ?? null);
    this.warehouseFilter.set(this.warehouseId() ?? '');
    this.warehousesApi.list().subscribe({
      next: (rows) => this.warehouses.set(rows),
      error: () => this.warehouses.set([]),
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.stock
      .movements({
        productId: this.productFilter(),
        warehouseId: this.warehouseFilter() || null,
        type: this.typeFilter() || null,
        from: this.from(),
        to: this.to(),
        page: this.page(),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.openingBalance.set(result.openingBalance);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'inventory.movements.load_failed'));
          this.loading.set(false);
        },
      });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  onFrom(value: string | null): void {
    this.from.set(value || null);
    this.applyFilters();
  }

  onTo(value: string | null): void {
    this.to.set(value || null);
    this.applyFilters();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.limit.set(size);
    this.applyFilters();
  }

  protected typeKey(type: string): string {
    return `inventory.movements.type.${type.toLowerCase()}`;
  }

  protected sourceLink(row: StockMovementRow): string | null {
    if (!row.sourceId || !row.sourceType) return null;
    const route = SOURCE_ROUTES[row.sourceType];
    return route ? route(row.sourceId) : null;
  }
}
