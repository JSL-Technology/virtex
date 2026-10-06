import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PackagePlus } from 'lucide-angular';
import { Observable } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VX_SELECT } from '../../../shared/components/select';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { Supplier } from '../../../core/models/supplier.model';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import { GoodsReceiptRow, GoodsReceiptStatus, PurchasingService } from '../data/purchasing.service';

export const GOODS_RECEIPT_TONE: Record<GoodsReceiptStatus, VxTone> = { POSTED: 'ok', VOID: 'neutral' };

/**
 * Goods receipts (audit H-03): every delivery recorded against a purchase order, newest first —
 * the list Odoo keeps under *Receipts*, NetSuite under *Item Receipts*. A delivery used to be a
 * table inside the order it arrived against, and could be found only by opening that order.
 */
@Component({
  selector: 'app-goods-receipts-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ...VX_SELECT,
    ListShellComponent,
    VxBadgeComponent,
    VxPagerComponent,
    VxBranchPickerComponent,
    VxBranchLabelComponent,
    HasPermissionDirective,
    RowLinkDirective,
  ],
  templateUrl: './receipts.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoodsReceiptsPage implements OnInit {
  private readonly purchasing = inject(PurchasingService);
  private readonly suppliersApi = inject(SuppliersService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);
  protected readonly branches = inject(BranchesService);

  /** `?orderId=` — the receipts of one order, from the order's page. */
  readonly orderId = input<string>();

  protected readonly NewIcon = PackagePlus;
  protected readonly tones = GOODS_RECEIPT_TONE;

  readonly rows = signal<GoodsReceiptRow[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(50);
  readonly supplierFilter = signal<string | null>(null);
  readonly warehouseFilter = signal('');
  readonly statusFilter = signal<GoodsReceiptStatus | ''>('');
  readonly branchFilter = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  protected readonly searchSuppliers = (query: string, limit: number): Observable<Supplier[]> =>
    this.suppliersApi.searchSuppliers(query, limit);
  protected readonly resolveSupplier = (id: string): Observable<Supplier> => this.suppliersApi.getSupplierById(id);
  protected readonly supplierName = (supplier: Supplier): string => supplier.name;
  protected readonly supplierId = (supplier: Supplier): string => supplier.id;

  ngOnInit(): void {
    this.warehousesApi.list().subscribe({
      next: (rows) => this.warehouses.set(rows),
      error: () => this.warehouses.set([]),
    });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.purchasing
      .receipts({
        orderId: this.orderId() ?? null,
        supplierId: this.supplierFilter(),
        warehouseId: this.warehouseFilter() || null,
        status: this.statusFilter() || null,
        branchId: this.branchFilter(),
        page: this.page(),
        limit: this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'purchasing.receipts.load_failed'));
          this.loading.set(false);
        },
      });
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

  protected warehouseName(id: string | null): string {
    if (!id) return '—';
    return this.warehouses().find((warehouse) => warehouse.id === id)?.name ?? '—';
  }
}
