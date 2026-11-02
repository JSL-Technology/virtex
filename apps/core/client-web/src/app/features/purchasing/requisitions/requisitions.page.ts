import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { CheckCircle, LucideAngularModule, PlusCircle, RotateCcw, RotateCw, Send, ShoppingCart, XCircle } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { catchError, of, startWith, switchMap } from 'rxjs';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import {
  PurchaseRequisition,
  PurchaseRequisitionStatus,
  PurchasingService,
} from '../../../core/api/purchasing.service';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';

/** Lo que significa cada estado de una solicitud. El color lo pone `vx-badge`, una vez. */
const STATUS_TONE: Record<PurchaseRequisitionStatus, VxTone> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'ok',
  REJECTED: 'danger',
  CONVERTED_TO_PO: 'info',
};

/**
 * Purchase requisitions: somebody asking to buy something.
 *
 * ## What this was
 *
 * Three requisitions written into the component — `REQ-001 Ana Pérez IT $2,500.00` and two more —
 * with a "department" column the data model never had and requester names that belong to nobody.
 * The endpoint existed the whole time and this screen never called it.
 */
@Component({
  selector: 'app-requisitions-page',
  standalone: true,
  imports: [...VX_CONTEXT_MENU, ...VX_SORT, RowLinkDirective, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './requisitions.page.html',
  styleUrls: ['./requisitions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequisitionsPage {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly requisitionsMenu: ListMenuConfig<PurchaseRequisition> = {
    resource: 'purchase-requisitions',
    relationshipMapType: 'PURCHASE_REQUISITION',
    row: (ctx) => {
      const req = ctx.entity as PurchaseRequisition;
      const path = `/purchasing/requisitions/${req.id}/edit`;
      const ask = (action: string) => this.menuIntents.request(path, action);
      return [
        {
          id: 'document',
          items: [
            { id: 'submit', label: 'purchasing.requisitions.form.submit', icon: Send, permission: 'procurement:manage', visible: () => req.status === 'DRAFT', run: () => ask('submit') },
            { id: 'approve', label: 'purchasing.requisitions.form.approve', icon: CheckCircle, permission: 'procurement:approve', visible: () => req.status === 'PENDING_APPROVAL', run: () => ask('approve') },
            { id: 'convert', label: 'purchasing.requisitions.form.convert_to_order', icon: ShoppingCart, permission: 'procurement:manage', visible: () => req.status === 'APPROVED', run: () => ask('convert') },
            { id: 'reopen', label: 'purchasing.requisitions.form.reopen', icon: RotateCcw, permission: 'procurement:manage', visible: () => ['REJECTED', 'PENDING_APPROVAL'].includes(req.status), run: () => ask('reopen') },
          ],
        },
        {
          id: 'corrections',
          items: [
            { id: 'reject', label: 'purchasing.requisitions.form.reject', icon: XCircle, danger: true, permission: 'procurement:approve', visible: () => req.status === 'PENDING_APPROVAL', run: () => ask('reject') },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.refresh() }] },
      ];
    },
  };

  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.requisitions(), { items: (req) => this.itemCount(req), status: (req) => this.translate.instant('purchasing.requisitions.status_label.' + req.status) });
  private readonly purchasing = inject(PurchasingService);

  protected readonly PlusCircleIcon = PlusCircle;

  /** Bumped to ask again — the row menu's «Refrescar». */
  private readonly refreshTick = signal(0);

  refresh(): void {
    this.refreshTick.update((tick) => tick + 1);
  }

  private readonly page = toSignal(
    toObservable(this.refreshTick).pipe(
      switchMap(() => this.purchasing.listRequisitions().pipe(catchError(() => of(null)), startWith(undefined))),
    ),
    { initialValue: undefined },
  );

  readonly requisitions = computed<PurchaseRequisition[]>(() => this.page()?.rows ?? []);
  readonly loading = computed(() => this.page() === undefined);
  readonly failed = computed(() => this.page() === null);

  statusTone(status: PurchaseRequisitionStatus): VxTone {
    return STATUS_TONE[status] ?? 'neutral';
  }

  /** How many things were asked for. The old screen showed a department the model never had. */
  itemCount(requisition: PurchaseRequisition): number {
    return requisition.lines?.length ?? 0;
  }
}
