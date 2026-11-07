import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Ban, CheckCircle, FileText, LucideAngularModule, Mail, PackageCheck, PlusCircle, RotateCw, Send, XCircle } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of, startWith, switchMap } from 'rxjs';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
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
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

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
  imports: [...VX_CONTEXT_MENU, ...VX_SORT, RowLinkDirective, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, FormsModule, ...VX_FORM_A11Y, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './orders.page.html',
  styleUrls: ['./orders.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrdersPage {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly ordersMenu: ListMenuConfig<PurchaseOrder> = {
    resource: 'purchase-orders',
    relationshipMapType: 'PURCHASE_ORDER',
    row: (ctx) => {
      const order = ctx.entity as PurchaseOrder;
      const path = `/purchasing/orders/${order.id}/edit`;
      const ask = (action: string) => this.menuIntents.request(path, action);
      return [
        {
          id: 'document',
          items: [
            { id: 'submit', label: 'purchasing.orders.form.submit', icon: Send, permission: 'procurement:manage', visible: () => order.status === 'DRAFT', run: () => ask('submit') },
            { id: 'approve', label: 'purchasing.orders.form.approve', icon: CheckCircle, permission: 'procurement:approve', visible: () => order.status === 'PENDING_APPROVAL', run: () => ask('approve') },
            { id: 'send', label: 'purchasing.orders.form.send', icon: Mail, permission: 'procurement:manage', visible: () => order.status === 'APPROVED', run: () => ask('send') },
            { id: 'receive', label: 'purchasing.orders.form.receive', icon: PackageCheck, permission: 'procurement:manage', visible: () => ['SENT', 'PARTIALLY_RECEIVED'].includes(order.status), run: () => this.menuNavigation.open(`/purchasing/receipts/new?orderId=${order.id}`, 'preview') },
            { id: 'create-bill', label: 'purchasing.orders.form.create_bill', icon: FileText, permission: 'accounts_payable:create', visible: () => ['SENT', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status), run: () => ask('create-bill') },
          ],
        },
        {
          id: 'corrections',
          items: [
            { id: 'reject', label: 'purchasing.orders.form.reject', icon: XCircle, danger: true, permission: 'procurement:approve', visible: () => order.status === 'PENDING_APPROVAL', run: () => ask('reject') },
            { id: 'cancel', label: 'purchasing.orders.form.cancel_order', icon: Ban, danger: true, permission: 'procurement:approve', visible: () => !['RECEIVED', 'CANCELLED'].includes(order.status), run: () => ask('cancel') },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.refresh() }] },
      ];
    },
  };

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
  /** Bumped to ask again with the same filter — the row menu's «Refrescar». */
  private readonly refreshTick = signal(0);

  refresh(): void {
    this.refreshTick.update((tick) => tick + 1);
  }

  private readonly page = toSignal(
    toObservable(computed(() => ({ branchId: this.branchFilter(), tick: this.refreshTick() }))).pipe(
      switchMap(({ branchId }) =>
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
