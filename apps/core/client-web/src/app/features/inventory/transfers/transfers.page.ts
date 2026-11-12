import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Ban, CheckCircle, LucideAngularModule, PlusCircle, RotateCw } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { StockTransfer, StockDocumentStatus, StockService } from '../data/stock.service';
import { STOCK_DOCUMENT_TONE } from '../adjustments/adjustment-form.page';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

import { VX_TABLE } from '../../../shared/components/table';
/** Transfers between warehouses: drafts, and what was posted, newest first. */
@Component({
  selector: 'app-stock-transfers-page',
  standalone: true,
  imports: [...VX_TABLE, ...VX_CONTEXT_MENU, FormsModule, ...VX_FORM_A11Y, RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, HasPermissionDirective, RowLinkDirective],
  templateUrl: './transfers.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StockTransfersPage implements OnInit {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly transfersMenu: ListMenuConfig<StockTransfer> = {
    resource: 'transfers',
    row: (ctx) => {
      const doc = ctx.entity as StockTransfer;
      const path = `/inventory/transfers/${doc.id}`;
      const ask = (action: string) => this.menuIntents.request(path, action);
      return [
        {
          id: 'document',
          items: [
            { id: 'post', label: 'inventory.transfers.post', icon: CheckCircle, permission: 'inventory:transfer', visible: () => doc.status === 'DRAFT', run: () => ask('post') },
          ],
        },
        {
          id: 'corrections',
          items: [
            { id: 'cancel', label: 'inventory.transfers.cancel_document', icon: Ban, danger: true, permission: 'inventory:transfer', visible: () => doc.status === 'DRAFT', run: () => ask('cancel') },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.load() }] },
      ];
    },
  };

  private readonly stock = inject(StockService);
  private readonly notifications = inject(NotificationService);

  protected readonly PlusIcon = PlusCircle;
  protected readonly tones = STOCK_DOCUMENT_TONE;

  readonly rows = signal<StockTransfer[]>([]);
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
    this.stock.transfers({ status: this.statusFilter() || undefined }).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'inventory.transfers.load_failed'));
        this.loading.set(false);
      },
    });
  }
}
