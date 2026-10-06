import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, ArrowLeftRight, ClipboardCheck } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxPagerComponent } from '../../../shared/components/pager';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { StockOnHandRow, StockService } from '../data/stock.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';

/**
 * Stock on hand: what each warehouse holds of each product, valued at average cost.
 *
 * The screen every inventory module opens with (MMBE, Inventory Item Locations, Odoo's on-hand
 * report) and the one this product did not have: the quantity lived on the product, one number for
 * the whole company, edited in the product form. Each row opens its kardex.
 */
@Component({
  selector: 'app-stock-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent, VxPagerComponent, HasPermissionDirective],
  templateUrl: './stock.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockPage implements OnInit {
  private readonly stock = inject(StockService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);

  /** From the URL: `?warehouseId=` opens the screen on one warehouse. */
  readonly warehouseId = input<string>();

  protected readonly AdjustIcon = ClipboardCheck;
  protected readonly TransferIcon = ArrowLeftRight;

  readonly rows = signal<StockOnHandRow[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly totalValue = signal(0);
  readonly page = signal(1);
  readonly limit = signal(100);
  readonly search = signal('');
  readonly warehouseFilter = signal<string>('');
  readonly includeZero = signal(false);

  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
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
      .onHand({
        warehouseId: this.warehouseFilter() || null,
        search: this.search() || undefined,
        includeZero: this.includeZero() || undefined,
        page: this.page(),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.totalValue.set(result.totalValue);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'inventory.stock.load_failed'));
          this.loading.set(false);
        },
      });
  }

  onSearch(term: string): void {
    this.search.set(term);
    this.applyFilters();
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.limit.set(size);
    this.applyFilters();
  }

  protected belowReorder(row: StockOnHandRow): boolean {
    return row.reorderLevel !== null && row.reorderLevel > 0 && row.quantityOnHand <= row.reorderLevel;
  }
}
