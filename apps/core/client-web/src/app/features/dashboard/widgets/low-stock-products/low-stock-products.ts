import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, Package, AlertCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { DashboardApiService, LowStockItem } from '../../../../core/api/dashboard-api.service';

/**
 * What is running out, from the catalogue.
 *
 * ## What this was
 *
 * A literal list of six products — a wireless mouse, an HD webcam, a mechanical keyboard — none of
 * which existed in any tenant's inventory. It was the same list for a hardware distributor and for
 * a hair salon, it never changed when stock moved, and clicking a row opened the edit page of a
 * product id that was not there.
 *
 * The threshold is the tenant's own reorder level. A product that has none is only reported once it
 * has actually run out: inventing a threshold would fill the panel with items nobody is worried
 * about, which is how a warning panel becomes wallpaper.
 */
@Component({
  selector: 'app-low-stock-products',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule],
  templateUrl: './low-stock-products.html',
  styleUrls: ['./low-stock-products.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LowStockProducts {
  private readonly dashboardApi = inject(DashboardApiService);

  protected readonly PackageIcon = Package;
  protected readonly AlertIcon = AlertCircle;

  private readonly items = toSignal(
    this.dashboardApi.getLowStock(10).pipe(catchError(() => of([] as LowStockItem[]))),
    { initialValue: [] as LowStockItem[] },
  );

  readonly lowStockProducts = computed(() => this.items());

  /**
   * How urgent this row is, relative to what the tenant said they wanted on hand.
   *
   * Not an absolute count: five units is critical for a wholesaler shipping pallets and comfortable
   * for a workshop that sells one a month. The reorder level is the tenant's own answer to that.
   */
  getStockSeverityClass(product: LowStockItem): string {
    if (product.stock <= 0) return 'critical';
    if (product.reorderLevel === null) return 'low';
    return product.stock <= product.reorderLevel / 2 ? 'warning' : 'low';
  }
}
