import { FormsModule } from '@angular/forms';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Ban, FileCheck, FileMinus, HandCoins, LucideAngularModule, MoreHorizontal, Pencil, PlusCircle, RotateCw, Send } from 'lucide-angular';
import { AccountsPayableService, VendorBill } from '../../../core/services/accounts-payable';
import { NotificationService } from '../../../core/services/notification';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { InboundMailInboxComponent } from '../../inbound-mail/inbound-mail-inbox.component';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-vendor-bills-list-page',
  standalone: true,
  imports: [...VX_CONTEXT_MENU, InboundMailInboxComponent, RowLinkDirective, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent, FormsModule, ...VX_FORM_A11Y, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VendorBillsListPage implements OnInit {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly billsMenu: ListMenuConfig<VendorBill> = {
    resource: 'vendor-bills',
    relationshipMapType: 'VENDOR_BILL',
    row: (ctx) => {
      const bill = ctx.entity as VendorBill;
      const path = `/accounts-payable/${bill.id}`;
      const ask = (action: string) => this.menuIntents.request(path, action);
      return [
        {
          id: 'document',
          items: [
            { id: 'edit', label: 'accounts_payable.detail.edit', icon: Pencil, permission: 'accounts_payable:edit', visible: () => bill.status === 'DRAFT', run: () => this.menuNavigation.open(`/accounts-payable/${bill.id}/edit`, 'preview') },
            { id: 'submit', label: 'accounts_payable.detail.submit_approval', icon: Send, permission: 'accounts_payable:approve', visible: () => bill.status === 'DRAFT', run: () => ask('submit') },
            { id: 'pay', label: 'accounts_payable.detail.pay', icon: HandCoins, permission: 'accounts_payable:pay', visible: () => ['OPEN', 'PARTIALLY_PAID'].includes(bill.status) && Number(bill.balance) > 0, run: () => this.menuNavigation.open(`/accounts-payable/payments/new?billId=${bill.id}`, 'preview') },
            { id: 'debit-note', label: 'accounts_payable.detail.debit_note', icon: FileMinus, permission: 'accounts_payable:create', visible: () => ['OPEN', 'PARTIALLY_PAID'].includes(bill.status) && Number(bill.balance) > 0, run: () => this.menuNavigation.open(`/accounts-payable/debit-notes/new?billId=${bill.id}`, 'preview') },
            { id: 'record-ncf', label: 'accounts_payable.detail.record_ncf', icon: FileCheck, permission: 'accounts_payable:edit', visible: () => !bill.ncf && !['DRAFT', 'VOID', 'REJECTED'].includes(bill.status), run: () => ask('record-ncf') },
          ],
        },
        {
          id: 'corrections',
          items: [
            { id: 'void', label: 'accounts_payable.detail.void', icon: Ban, danger: true, permission: 'accounts_payable:void', visible: () => !['VOID', 'PAID', 'PARTIALLY_PAID'].includes(bill.status), run: () => ask('void') },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.loadVendorBills() }] },
      ];
    },
  };

  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.vendorBills(), { vendor: (bill) => bill.vendor?.name, status: (bill) => this.translate.instant(this.statusKey(bill.status)) });
  protected readonly PlusCircleIcon = PlusCircle;

  private accountsPayableService = inject(AccountsPayableService);
  private notificationService = inject(NotificationService);

  vendorBills = signal<VendorBill[]>([]);
  /** Empty: every branch the person may see. */
  readonly branchFilter = signal<string | null>(null);
  protected readonly branches = inject(BranchesService);
  isLoading = signal(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadVendorBills();
  }

  setBranch(branchId: string | null): void {
    this.branchFilter.set(branchId);
    this.loadVendorBills();
  }

  loadVendorBills(): void {
    this.isLoading.set(true);
    this.error.set(null);
    this.accountsPayableService.getVendorBills(this.branchFilter()).subscribe({
      next: (data) => {
        this.vendorBills.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.error.set('accounts_payable.list.load_failed');
        this.notificationService.showError('accounts_payable.list.load_failed');
        this.isLoading.set(false);
      },
    });
  }

  /**
   * The stored status becomes a catalogue key.
   *
   * The switch below compared against `'Paid'`, `'Approved'`, `'Submitted'` and `'Void'` — five
   * title-case words the server has never sent, since the enum is uppercase. Every bill therefore
   * fell through to `status-draft`, and the badge printed the raw enum member next to it.
   */
  statusKey(status: VendorBill['status']): string {
    return `accounts_payable.status.${status}`;
  }

  /**
   * What the state of a bill MEANS, which is the only thing a badge needs.
   *
   * It used to return a CSS class, and the five classes it returned were not five colours: `PAID`
   * and `OPEN` both rendered green-ish through `.status-paid` / `.status-approved` defined in
   * this page's own stylesheet. The tone says the thing directly — settled, in progress, waiting,
   * rejected — and one stylesheet gives each one its colour for the whole product.
   */
  statusTone(status: VendorBill['status']): VxTone {
    switch (status) {
      case 'PAID':
        return 'ok';
      case 'PARTIALLY_PAID':
      case 'OPEN':
        return 'info';
      case 'PENDING_APPROVAL':
        return 'warning';
      case 'VOID':
      case 'REJECTED':
        return 'danger';
      default:
        return 'draft';
    }
  }

  /** Anulada o rechazada: la factura existe y ya no cuenta. */
  isVoid(status: VendorBill['status']): boolean {
    return status === 'VOID' || status === 'REJECTED';
  }
}
