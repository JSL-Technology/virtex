import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import {
  CustomerReceipt,
  CustomerReceiptsService,
} from '../../../core/services/customer-receipts';
import { CustomersService } from '../../../core/api/customers.service';
import { Customer } from '../../../core/models/customer.model';
import { NotificationService } from '../../../core/services/notification';

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
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './list.page.html',
  styleUrls: ['./list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomerReceiptsListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

  private readonly receipts = inject(CustomerReceiptsService);
  private readonly customers = inject(CustomersService);
  private readonly notifications = inject(NotificationService);

  readonly items = signal<CustomerReceipt[]>([]);
  readonly customerList = signal<Customer[]>([]);
  readonly isLoading = signal(true);

  private readonly customersById = computed(
    () => new Map(this.customerList().map((customer) => [customer.id, customer])),
  );

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.isLoading.set(true);
    this.receipts.list().subscribe({
      next: (data) => {
        this.items.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notifications.showError(
          'CUSTOMER_RECEIPTS.LIST.COULD_NOT_LOAD_CUSTOMER_RECEIPTS',
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
