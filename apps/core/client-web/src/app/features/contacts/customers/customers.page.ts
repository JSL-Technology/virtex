import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { Customer } from '../../../core/models/customer.model';
import { CustomersService } from '../../../core/api/customers.service';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-customers-page',
  imports: [RouterLink, LucideAngularModule],
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
        this.notificationService.showError('No se pudieron cargar los clientes.');
        this.isLoading.set(false);
      },
    });
  }

  deleteCustomer(id: string): void {
    if (confirm('¿Estás seguro de que deseas eliminar este cliente?')) {
      this.customersService.deleteCustomer(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('Cliente eliminado exitosamente.');
          this.loadCustomers();
        },
        error: () => {
          this.notificationService.showError('No se pudo eliminar el cliente.');
        }
      });
    }
  }
}
