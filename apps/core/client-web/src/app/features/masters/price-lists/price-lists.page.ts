import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Edit, Trash2 } from 'lucide-angular';
import { PriceList } from '../../../core/models/price-list.model';
import { PriceListsService } from '../../../core/api/price-lists.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';

@Component({
  selector: 'app-price-lists-page',
  imports: [RowLinkDirective, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './price-lists.page.html',
  styleUrls: ['./price-lists.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PriceListsPage implements OnInit {
  private readonly translate = inject(TranslateService);
  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.priceLists(), { items: (list) => list.items.length, status: (list) => this.translate.instant('masters.price_lists.status_label.' + list.status) });
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
        error: (error: unknown) => {
          this.notificationService.showHttpError(error, 'masters.price_lists.price_list_could_not_deleted');
        }
      });
    }
  }

  statusTone(status: PriceList['status']): VxTone {
    if (status === 'Active') return 'ok';
    if (status === 'Inactive') return 'neutral';
    return 'draft';
  }
}
