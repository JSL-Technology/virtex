import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Edit, Trash2 } from 'lucide-angular';
import { PriceList } from '../../../core/models/price-list.model';
import { PriceListsService } from '../../../core/api/price-lists.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-price-lists-page',
  imports: [RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './price-lists.page.html',
  styleUrls: ['./price-lists.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceListsPage implements OnInit {
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
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
        this.notificationService.showError('masters.price_lists.price_lists_could_not_loaded');
        this.isLoading.set(false);
      },
    });
  }

  async deletePriceList(id: string): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_price_list.title',
      message: 'dialog.delete_price_list.message',
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) {
      this.priceListsService.deletePriceList(id).subscribe({
        next: () => {
          this.notificationService.showSuccess('masters.price_lists.price_list_deleted');
          this.loadPriceLists();
        },
        error: () => {
          this.notificationService.showError('masters.price_lists.price_list_could_not_deleted');
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
