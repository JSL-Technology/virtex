import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Ban, LucideAngularModule } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { DocumentShellComponent } from '../../../shared/components/gestures';
import { VxBranchLabelComponent } from '../../../shared/components/branch-picker';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import { GoodsReceipt, PurchasingService } from '../data/purchasing.service';
import { GOODS_RECEIPT_TONE } from './receipts.page';

const QUANTITY_EPSILON = 0.000001;

/**
 * One goods receipt, read: what arrived against which order, where, at what value, and the entry
 * it posted. Voiding it (MIGO 102) is offered only while none of it has been billed — after that
 * the goods go back to the supplier with a debit note, which is the document for a return.
 */
@Component({
  selector: 'app-goods-receipt-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, DocumentShellComponent, VxBranchLabelComponent, HasPermissionDirective],
  templateUrl: './receipt.page.html',
  styleUrls: ['../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoodsReceiptPage implements OnInit {
  private readonly purchasing = inject(PurchasingService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  protected readonly branches = inject(BranchesService);

  readonly id = input.required<string>();

  protected readonly VoidIcon = Ban;

  readonly receipt = signal<GoodsReceipt | null>(null);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly tone = computed(() => GOODS_RECEIPT_TONE[this.receipt()?.status ?? 'POSTED']);
  /** Billed already: the bill cleared «received not invoiced» for it, so it is returned, not voided. */
  readonly billed = computed(() => {
    const receipt = this.receipt();
    if (!receipt) return false;
    return receipt.lines.some((line) => {
      if (line.receivedOnOrder === null || line.billedOnOrder === null) return false;
      return line.billedOnOrder - (line.receivedOnOrder - line.quantity) > QUANTITY_EPSILON;
    });
  });
  readonly canVoid = computed(() => this.receipt()?.status === 'POSTED' && !this.billed());
  readonly warehouseName = computed(() => {
    const id = this.receipt()?.warehouseId;
    return id ? (this.warehouses().find((warehouse) => warehouse.id === id)?.name ?? null) : null;
  });

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
    this.purchasing.receipt(this.id()).subscribe({
      next: (receipt) => {
        this.receipt.set(receipt);
        this.tab?.setTitle(receipt.number);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'purchasing.receipts.load_one_failed'));
        this.loading.set(false);
      },
    });
  }

  entryLink(entryId: string | null): string | null {
    return entryId ? this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`) : null;
  }

  async voidReceipt(): Promise<void> {
    const receipt = this.receipt();
    if (!receipt) return;
    const reason = await this.dialog.prompt({
      title: 'purchasing.receipts.void_title',
      message: 'purchasing.receipts.void_message',
      messageParams: { number: receipt.number },
      placeholder: 'purchasing.receipts.void_reason',
      minLength: 3,
      tooShort: 'purchasing.receipts.void_reason_too_short',
      variant: 'danger',
    });
    if (!reason) return;
    this.busy.set(true);
    this.purchasing.voidReceipt(receipt.id, reason).subscribe({
      next: (voided) => {
        this.busy.set(false);
        this.receipt.set(voided);
        this.notifications.showSuccess('purchasing.receipts.voided', { number: voided.number });
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'purchasing.receipts.void_failed');
      },
    });
  }

  goToList(): void {
    void this.router.navigateByUrl(this.organization.urlFor('/purchasing/receipts'));
  }
}
