import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchasingService,
} from '../../../core/api/purchasing.service';

/** Which badge colour each status carries. Green means the goods are in. */
const STATUS_CLASS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'status-draft',
  PENDING_APPROVAL: 'status-pending',
  APPROVED: 'status-approved',
  SENT: 'status-sent',
  PARTIALLY_RECEIVED: 'status-pending',
  RECEIVED: 'status-approved',
  CANCELLED: 'status-rejected',
};

/**
 * Purchase orders.
 *
 * ## What this was
 *
 * Four orders written into the component — `PO-2025-001 OfiSuministros SRL $1,250.00 Sent` and
 * three more — with no table, no endpoint and no way to create a fifth. Every tenant of the
 * product saw the same four, dated July 2025, for ever. A buyer could look at this screen and not
 * act on it.
 */
@Component({
  selector: 'app-orders-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersPage {
  private readonly purchasing = inject(PurchasingService);

  protected readonly PlusCircleIcon = PlusCircle;

  /** Null while loading, so an empty list and a pending request look different to the reader. */
  private readonly page = toSignal(
    this.purchasing.listOrders().pipe(catchError(() => of(null))),
    { initialValue: undefined },
  );

  readonly orders = computed<PurchaseOrder[]>(() => this.page()?.rows ?? []);
  readonly loading = computed(() => this.page() === undefined);
  readonly failed = computed(() => this.page() === null);

  getStatusClass(status: PurchaseOrderStatus): string {
    return STATUS_CLASS[status] ?? 'status-draft';
  }
}
