import { FormsModule } from '@angular/forms';
import { VxBranchLabelComponent, VxBranchPickerComponent } from '../../../shared/components/branch-picker';
import { BranchesService } from '../../../core/tenancy/branches.service';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
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
  imports: [...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent, FormsModule, VxBranchPickerComponent, VxBranchLabelComponent],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptsListPage implements OnInit {
  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.items(), { customer: (receipt) => this.customerName(receipt.customerId), status: (receipt) => this.translate.instant('customer_receipts.status.' + receipt.status) });
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly receipts = inject(CustomerReceiptsService);
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
