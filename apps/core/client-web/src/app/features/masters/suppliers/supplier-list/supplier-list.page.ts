import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal } from 'lucide-angular';
import { SuppliersService } from '../../../../core/api/suppliers.service';
import { NotificationService } from '../../../../core/services/notification';
import { Supplier } from '../../../../core/models/supplier.model';

@Component({
  selector: 'app-suppliers-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule],
  templateUrl: './supplier-list.page.html',
  styleUrls: ['./supplier-list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupplierListPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;

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
}