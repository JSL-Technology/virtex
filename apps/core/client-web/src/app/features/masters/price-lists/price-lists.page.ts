import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { PriceList } from '../../../core/models/price-list.model';
import { PriceListsService } from '../../../core/api/price-lists.service';
import { NotificationService } from '../../../core/services/notification';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'app-price-lists-page',
  imports: [RouterLink, LucideAngularModule, DatePipe],
  templateUrl: './price-lists.page.html',
  styleUrls: ['./price-lists.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceListsPage implements OnInit {
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly EditIcon = Edit;
  protected readonly TrashIcon = Trash2;

  private priceListsService = inject(PriceListsService);
  private notificationService = inject(NotificationService);

  priceLists = signal<PriceList[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.loadPriceLists();
  }

  loadPriceLists(): void {
    this.isLoading.set(true);
    this.priceListsService.getPriceLists().subscribe({
      next: (data) => {
        this.priceLists.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('No se pudieron cargar las listas de precios.');
        this.isLoading.set(false);
      },
    });
  }

  deletePriceList(id: string): void {
    if (confirm('¿Estás seguro de que deseas eliminar esta lista de precios?')) {
      this.priceListsService.deletePriceList(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('Lista de precios eliminada exitosamente.');
          this.loadPriceLists();
        },
        error: () => {
          this.notificationService.showError('No se pudo eliminar la lista de precios.');
        }
      });
    }
  }

  getStatusClass(status: PriceList['status']): string {
    if (status === 'Active') return 'status-active';
    if (status === 'Inactive') return 'status-inactive';
    return 'status-draft';
  }
}
