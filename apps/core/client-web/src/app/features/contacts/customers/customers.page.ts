import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { Customer } from '../../../core/models/customer.model';
import { CustomersService } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-customers-page',
  imports: [RouterLink, LucideAngularModule, TranslateModule],
  templateUrl: './customers.page.html',
  styleUrls: ['./customers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomersPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
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
        this.notificationService.showError('CONTACTS.CUSTOMERS.PUDIERON_CARGAR_CLIENTES');
        this.isLoading.set(false);
      },
    });
  }

  deleteCustomer(id: string): void {
    if (confirm('¿Estás seguro de que deseas eliminar este cliente?')) {
      this.customersService.deleteCustomer(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('CONTACTS.CUSTOMERS.CLIENTE_ELIMINADO_EXITOSAMENTE');
          this.loadCustomers();
        },
        error: () => {
          this.notificationService.showError('CONTACTS.CUSTOMERS.PUDO_ELIMINAR_CLIENTE');
        }
      });
    }
  }
}
