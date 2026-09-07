import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { SuppliersService } from '../../../../core/api/suppliers.service';
import { NotificationService } from '../../../../core/services/notification';
import { Supplier } from '../../../../core/models/supplier.model';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../../../shared/components/gestures';

@Component({
  selector: 'app-suppliers-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './supplier-list.page.html',
  styleUrls: ['./supplier-list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;

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
        this.notificationService.showError('MASTERS.SUPPLIER_LIST.PUDIERON_CARGAR_PROVEEDORES');
        this.isLoading.set(false);
      },
    });
  }
}