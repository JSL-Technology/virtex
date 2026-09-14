import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { Customer } from '../../../core/models/customer.model';
import { CustomersService } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-customers-page',
  imports: [RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './customers.page.html',
  styleUrls: ['./customers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomersPage implements OnInit {
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash2;

  private customersService = inject(CustomersService);
  private notificationService = inject(NotificationService);

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

  async deleteCustomer(id: string): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_customer.title',
      message: 'dialog.delete_customer.message',
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) {
      this.customersService.deleteCustomer(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('contacts.customers.customer_deleted');
          this.loadCustomers();
        },
        error: () => {
          this.notificationService.showError('contacts.customers.customer_could_not_deleted');
        }
      });
    }
  }
}
