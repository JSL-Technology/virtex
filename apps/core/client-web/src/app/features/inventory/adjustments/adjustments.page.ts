import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { InventoryAdjustment, StockDocumentStatus, StockService } from '../data/stock.service';
import { STOCK_DOCUMENT_TONE } from './adjustment-form.page';

/** Inventory adjustments: drafts waiting to be posted, and what was posted, newest first. */
@Component({
  selector: 'app-inventory-adjustments-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, HasPermissionDirective, RowLinkDirective],
  templateUrl: './adjustments.page.html',
  styleUrls: ['../shared/inventory-filters.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InventoryAdjustmentsPage implements OnInit {
  private readonly stock = inject(StockService);
  private readonly notifications = inject(NotificationService);

  protected readonly PlusIcon = PlusCircle;
  protected readonly tones = STOCK_DOCUMENT_TONE;

  readonly rows = signal<InventoryAdjustment[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly statusFilter = signal<StockDocumentStatus | ''>('');
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.stock.adjustments({ status: this.statusFilter() || undefined }).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'inventory.adjustments.load_failed'));
        this.loading.set(false);
      },
    });
  }
}
