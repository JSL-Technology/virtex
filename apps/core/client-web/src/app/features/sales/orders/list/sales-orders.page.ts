import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../../shared/components/badge';
import { RowLinkDirective } from '../../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../../core/services/notification';
import { SalesOrder, SalesOrderStatus, SalesOrdersService } from '../data/sales-orders.service';

export const ORDER_TONE: Record<SalesOrderStatus, VxTone> = {
  CONFIRMED: 'info',
  PARTIALLY_DELIVERED: 'warning',
  DELIVERED: 'accent',
  CLOSED: 'ok',
  CANCELLED: 'danger',
};

export const ORDER_STATUSES: SalesOrderStatus[] = ['CONFIRMED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CANCELLED'];

/** Sales orders: what customers ordered, how much left with a conduce, how much is invoiced. */
@Component({
  selector: 'app-sales-orders-page',
  standalone: true,
  imports: [RouterLink, RowLinkDirective, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './sales-orders.page.html',
  styleUrls: ['../../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SalesOrdersPage implements OnInit {
  private readonly orders = inject(SalesOrdersService);
  private readonly notifications = inject(NotificationService);

  readonly statuses = ORDER_STATUSES;
  readonly tone = ORDER_TONE;
  readonly rows = signal<SalesOrder[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal<SalesOrderStatus | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orders.list(this.filter() ?? undefined).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'sales.orders.load_failed'));
      },
    });
  }

  setFilter(status: SalesOrderStatus | null): void {
    this.filter.set(status);
    this.load();
  }
}
