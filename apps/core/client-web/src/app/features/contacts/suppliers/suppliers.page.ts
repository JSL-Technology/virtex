import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { Supplier } from '../../../core/models/supplier.model';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-suppliers-page',
  imports: [RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './suppliers.page.html',
  styleUrls: ['./suppliers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuppliersPage implements OnInit {
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
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
        this.notificationService.showError('contacts.suppliers.suppliers_could_not_loaded');
        this.isLoading.set(false);
      },
    });
  }

  async deleteSupplier(id: string): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_supplier.title',
      message: 'dialog.delete_supplier.message',
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) {
      this.suppliersService.deleteSupplier(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('contacts.suppliers.supplier_deleted');
          this.loadSuppliers();
        },
        error: () => {
          this.notificationService.showError('contacts.suppliers.supplier_could_not_deleted');
        }
      });
    }
  }
}
