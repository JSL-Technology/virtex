import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, of, startWith, switchMap } from 'rxjs';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import {
  PurchaseOrder,
  PurchaseOrderStatus,
  PurchasingService,
} from '../../../core/api/purchasing.service';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/** Which badge colour each status carries. Green means the goods are in. */
/** Lo que significa cada estado de un pedido. El color lo pone `vx-badge`, una vez. */
const STATUS_TONE: Record<PurchaseOrderStatus, VxTone> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SENT: 'info',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'ok',
  CANCELLED: 'danger',
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
  imports: [...VX_SORT, RowLinkDirective, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, FormsModule, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersPage {
  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.orders(), { supplier: (order) => order.supplier?.name, status: (order) => this.translate.instant('purchasing.orders.status_label.' + order.status) });
  private readonly purchasing = inject(PurchasingService);

  protected readonly PlusCircleIcon = PlusCircle;

  protected readonly branches = inject(BranchesService);
  /** Empty: every branch the person may see. */
  readonly branchFilter = signal<string | null>(null);

  /**
   * Undefined while loading and null on failure, so an empty list and a pending request look
   * different to the reader. Asked again whenever the branch filter changes.
   */
  private readonly page = toSignal(
    toObservable(this.branchFilter).pipe(
      switchMap((branchId) =>
        this.purchasing.listOrders(1, 50, branchId).pipe(
          catchError(() => of(null)),
          startWith(undefined),
        ),
      ),
    ),
    { initialValue: undefined },
  );

  readonly orders = computed<PurchaseOrder[]>(() => this.page()?.rows ?? []);
  readonly loading = computed(() => this.page() === undefined);
  readonly failed = computed(() => this.page() === null);

  statusTone(status: PurchaseOrderStatus): VxTone {
    return STATUS_TONE[status] ?? 'neutral';
  }
}
