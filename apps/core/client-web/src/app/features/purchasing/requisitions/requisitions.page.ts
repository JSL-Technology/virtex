import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';
import {
  PurchaseRequisition,
  PurchaseRequisitionStatus,
  PurchasingService,
} from '../../../core/api/purchasing.service';

const STATUS_CLASS: Record<PurchaseRequisitionStatus, string> = {
  DRAFT: 'status-draft',
  PENDING_APPROVAL: 'status-pending',
  APPROVED: 'status-approved',
  REJECTED: 'status-rejected',
  CONVERTED_TO_PO: 'status-sent',
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
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './requisitions.page.html',
  styleUrls: ['./requisitions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequisitionsPage {
  private readonly purchasing = inject(PurchasingService);

  protected readonly PlusCircleIcon = PlusCircle;

  private readonly page = toSignal(
    this.purchasing.listRequisitions().pipe(catchError(() => of(null))),
    { initialValue: undefined },
  );

  readonly requisitions = computed<PurchaseRequisition[]>(() => this.page()?.rows ?? []);
  readonly loading = computed(() => this.page() === undefined);
  readonly failed = computed(() => this.page() === null);

  getStatusClass(status: PurchaseRequisitionStatus): string {
    return STATUS_CLASS[status] ?? 'status-draft';
  }

  /** How many things were asked for. The old screen showed a department the model never had. */
  itemCount(requisition: PurchaseRequisition): number {
    return requisition.lines?.length ?? 0;
  }
}
