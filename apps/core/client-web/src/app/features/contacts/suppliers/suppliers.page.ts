import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { Supplier } from '../../../core/models/supplier.model';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { NotificationService } from '../../../core/services/notification';

@Component({
  selector: 'app-suppliers-page',
  imports: [RouterLink, LucideAngularModule],
  templateUrl: './suppliers.page.html',
  styleUrls: ['./suppliers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuppliersPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash2;

  private suppliersService = inject(SuppliersService);
  private notificationService = inject(NotificationService);

  suppliers = signal<Supplier[]>([]);
  isLoading = signal<boolean>(true);

  ngOnInit(): void {
    this.loadSuppliers();
  }

  loadSuppliers(): void {
    this.isLoading.set(true);
    this.suppliersService.getSuppliers().subscribe({
      next: (data) => {
        this.suppliers.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('No se pudieron cargar los proveedores.');
        this.isLoading.set(false);
      },
    });
  }

  deleteSupplier(id: string): void {
    if (confirm('¿Estás seguro de que deseas eliminar este proveedor?')) {
      this.suppliersService.deleteSupplier(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('Proveedor eliminado exitosamente.');
          this.loadSuppliers();
        },
        error: () => {
          this.notificationService.showError('No se pudo eliminar el proveedor.');
        }
      });
    }
  }
}
