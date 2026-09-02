import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2 } from 'lucide-angular';
import { PriceList } from '../../../core/models/price-list.model';
import { PriceListsService } from '../../../core/api/price-lists.service';
import { NotificationService } from '../../../core/services/notification';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

@Component({
  selector: 'app-price-lists-page',
  imports: [RouterLink, LucideAngularModule, DatePipe, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './price-lists.page.html',
  styleUrls: ['./price-lists.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceListsPage implements OnInit {
  private readonly dialog = inject(DialogService);
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
        this.notificationService.showError('MASTERS.PRICE_LISTS.PUDIERON_CARGAR_LISTAS_PRECIOS');
        this.isLoading.set(false);
      },
    });
  }

  async deletePriceList(id: string): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_PRICE_LIST.TITLE',
      message: 'DIALOG.DELETE_PRICE_LIST.MESSAGE',
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (confirmed) {
      this.priceListsService.deletePriceList(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('MASTERS.PRICE_LISTS.LISTA_PRECIOS_ELIMINADA_EXITOSAMENTE');
          this.loadPriceLists();
        },
        error: () => {
          this.notificationService.showError('MASTERS.PRICE_LISTS.PUDO_ELIMINAR_LISTA_PRECIOS');
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
