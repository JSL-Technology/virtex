import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { NotificationService } from '../../../core/services/notification';
import { DeliveryNote, DeliveryNoteStatus, SalesOrdersService } from '../orders/data/sales-orders.service';
import { openForPrint } from '../orders/detail/sales-order.page';

const TONE: Record<DeliveryNoteStatus, VxTone> = { POSTED: 'info', INVOICED: 'ok', VOIDED: 'danger' };

/** Conduces: every delivery that left, and whether it has been invoiced yet. */
@Component({
  selector: 'app-deliveries-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './deliveries.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeliveriesPage implements OnInit {
  private readonly orders = inject(SalesOrdersService);
  private readonly notifications = inject(NotificationService);

  readonly tone = TONE;
  readonly statuses: DeliveryNoteStatus[] = ['POSTED', 'INVOICED', 'VOIDED'];
  readonly rows = signal<DeliveryNote[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly filter = signal<DeliveryNoteStatus | null>('POSTED');
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.orders.deliveries(this.filter() ?? undefined).subscribe({
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

  setFilter(status: DeliveryNoteStatus | null): void {
    this.filter.set(status);
    this.load();
  }

  print(note: DeliveryNote): void {
    this.orders.printDelivery(note.id).subscribe({
      next: (html) => openForPrint(html),
      error: (error: unknown) => this.notifications.showHttpError(error, 'sales.orders.print_failed'),
    });
  }
}
