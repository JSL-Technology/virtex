import { PhonePipe } from '../../../shared/pipes/phone.pipe';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2, ScrollText } from 'lucide-angular';
import { Customer } from '../../../core/models/customer.model';
import { CustomersService } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { SafeDeleteService } from '../../../core/services/safe-delete.service';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { VxBadgeComponent } from '../../../shared/components/badge';

@Component({
  selector: 'app-customers-page',
  imports: [PhonePipe, HasPermissionDirective, RowLinkDirective, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ListShellComponent, VxBadgeComponent],
  templateUrl: './customers.page.html',
  styleUrls: ['./customers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomersPage implements OnInit {
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.customers());
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly EditIcon = Edit;
  protected readonly StatementIcon = ScrollText;
  protected readonly TrashIcon = Trash2;

  private customersService = inject(CustomersService);
  private notificationService = inject(NotificationService);
  private readonly safeDelete = inject(SafeDeleteService);

  customers = signal<Customer[]>([]);
  isLoading = signal<boolean>(true);

  ngOnInit(): void {
    this.loadCustomers();
  }

  loadCustomers(): void {
    this.isLoading.set(true);
    this.customersService.getCustomers().subscribe({
      next: (data) => {
        this.customers.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('contacts.customers.customers_could_not_loaded');
        this.isLoading.set(false);
      },
    });
  }

  /** Deleting asks first what still uses the customer, and offers to deactivate it (QA A-08). */
  async deleteCustomer(customer: Customer): Promise<void> {
    const name = customer.companyName;
    const outcome = await this.safeDelete.run({
      name,
      check: () => this.customersService.dependents(customer.id),
      remove: () => this.customersService.deleteCustomer(customer.id),
      deactivate: () => this.customersService.updateCustomer(customer.id, { status: 'INACTIVE' }),
      keys: {
        confirmTitle: 'dialog.delete_customer.title',
        confirmMessage: 'dialog.delete_customer.message_named',
        deleted: 'contacts.customers.customer_deleted',
        deleteFailed: 'contacts.customers.customer_could_not_deleted',
        blockedTitle: 'contacts.customers.delete_blocked_title',
        blockedMessage: 'contacts.customers.delete_blocked_message',
        deactivated: 'contacts.customers.customer_deactivated',
      },
    });
    if (outcome !== 'cancelled') this.loadCustomers();
  }
}
