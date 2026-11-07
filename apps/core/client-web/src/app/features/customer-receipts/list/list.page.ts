import { DialogService } from '../../../core/services/dialog.service';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { FormsModule } from '@angular/forms';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Ban, HandCoins, LucideAngularModule, PlusCircle, RotateCw, ScrollText } from 'lucide-angular';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, FORMAT_PIPES, tenantToday } from '@virteex/shared/ui-i18n';
import {
  CustomerReceipt,
  CustomerReceiptsService,
} from '../../../core/services/customer-receipts';
import { CustomersService } from '../../../core/api/customers.service';
import { Customer } from '../../../core/models/customer.model';
import { NotificationService } from '../../../core/services/notification';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/**
 * Collections received from customers.
 *
 * The list printed `receipt.customerName` and `receipt.amount`, neither of which the server sends:
 * the interface it was typed against was invented alongside a service whose only comment was
 * "assuming this is the new endpoint". The customer's name is resolved from the customer list, and
 * every other column is a field the payment actually has — including the unapplied balance, which
 * is how an advance shows up, and the void state, which is how a bounced cheque does.
 */
@Component({
  selector: 'app-customer-receipts-list-page',
  standalone: true,
  imports: [...VX_CONTEXT_MENU, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent, FormsModule, ...VX_FORM_A11Y, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptsListPage implements OnInit {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly receiptsMenu: ListMenuConfig<CustomerReceipt> = {
    resource: 'customer-receipts',
    relationshipMapType: 'CUSTOMER_PAYMENT',
    row: (ctx) => {
      const receipt = ctx.entity as CustomerReceipt;
      const open = (path: string) => this.menuNavigation.open(path, 'preview');
      return [
        {
          id: 'customer',
          items: [
            { id: 'collect', label: 'contacts.customers.menu.register_collection', icon: HandCoins, permission: 'accounts_receivable:collect', run: () => open(`/customer-receipts/new?customerId=${receipt.customerId}`) },
            { id: 'statement', label: 'contacts.customers.menu.statement', icon: ScrollText, permission: 'accounting:view', run: () => open(`/accounting/partner-ledger?type=customer&partnerId=${receipt.customerId}`) },
          ],
        },
        {
          id: 'corrections',
          items: [
            { id: 'void', label: 'customer_receipts.void', icon: Ban, danger: true, permission: 'accounts_receivable:void', visible: () => receipt.status !== 'VOID', run: () => this.voidReceipt(receipt) },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.load() }] },
      ];
    },
  };

  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.items(), { customer: (receipt) => this.customerName(receipt.customerId), status: (receipt) => this.translate.instant('customer_receipts.status.' + receipt.status) });
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly receipts = inject(CustomerReceiptsService);
  private readonly dialog = inject(DialogService);

  /**
   * Void a receipt from its row (QA R3-B08). The API and its client could do it and no screen
   * offered it: a collection recorded against the wrong invoice could not be undone. The reason is
   * asked for, as the API requires; the reversal is dated today in the company's calendar.
   */
  async voidReceipt(receipt: CustomerReceipt): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'customer_receipts.void_title',
      message: 'customer_receipts.void_message',
      messageParams: { number: receipt.receiptNumber ?? '' },
      confirmText: 'customer_receipts.void',
      variant: 'danger',
      minLength: 3,
      tooShort: 'customer_receipts.void_reason_required',
    });
    if (!reason) return;
    this.receipts.void(receipt.id, reason.trim(), tenantToday()).subscribe({
      next: () => {
        this.notifications.showSuccess('customer_receipts.voided', { number: receipt.receiptNumber ?? '' });
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'customer_receipts.void_failed'),
    });
  }
  private readonly customers = inject(CustomersService);
  private readonly notifications = inject(NotificationService);

  readonly items = signal<CustomerReceipt[]>([]);
  /** Empty: every branch the person may see. */
  readonly branchFilter = signal<string | null>(null);
  protected readonly branches = inject(BranchesService);
  readonly customerList = signal<Customer[]>([]);
  readonly isLoading = signal(true);

  private readonly customersById = computed(
    () => new Map(this.customerList().map((customer) => [customer.id, customer])),
  );

  ngOnInit(): void {
    this.load();
  }

  setBranch(branchId: string | null): void {
    this.branchFilter.set(branchId);
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.receipts.list(undefined, this.branchFilter()).subscribe({
      next: (data) => {
        this.items.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notifications.showError(
          'customer_receipts.list.could_not_load_customer_receipts',
        );
        this.isLoading.set(false);
      },
    });
    this.customers.getCustomers().subscribe({
      next: (data) => this.customerList.set(data),
      error: () => this.customerList.set([]),
    });
  }

  customerName(customerId: string): string {
    const customer = this.customersById().get(customerId);
    return customer?.companyName ?? customerId.slice(0, 8);
  }
}
