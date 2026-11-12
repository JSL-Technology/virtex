import { NavigationActionsService } from '../../../core/navigation/navigation-actions.service';
import { DocumentIntentService } from '../../../core/navigation/document-intent.service';
import { ListMenuConfig, VX_CONTEXT_MENU } from '../../../shared/components/context-menu';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { Edit, FileText, Filter, LucideAngularModule, MoreHorizontal, Pencil, PlusCircle, RotateCw, ScrollText, ShoppingCart, Trash2 } from 'lucide-angular';
import { Supplier } from '../../../core/models/supplier.model';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { NotificationService } from '../../../core/services/notification';
import { SafeDeleteService } from '../../../core/services/safe-delete.service';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';

import { VX_TABLE } from '../../../shared/components/table';
@Component({
  selector: 'app-suppliers-page',
  imports: [...VX_TABLE, ...VX_CONTEXT_MENU, HasPermissionDirective, RowLinkDirective, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './suppliers.page.html',
  styleUrls: ['./suppliers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuppliersPage implements OnInit {
  private readonly menuIntents = inject(DocumentIntentService);
  private readonly menuNavigation = inject(NavigationActionsService);

  readonly suppliersMenu: ListMenuConfig<Supplier> = {
    resource: 'suppliers',
    row: (ctx) => {
      const supplier = ctx.entity as Supplier;
      const open = (path: string) => this.menuNavigation.open(path, 'preview');
      return [
        {
          id: 'buy',
          items: [
            { id: 'bill', label: 'contacts.suppliers.menu.new_bill', icon: FileText, permission: 'accounts_payable:create', run: () => open(`/accounts-payable/new?supplierId=${supplier.id}`) },
            { id: 'order', label: 'contacts.suppliers.menu.new_order', icon: ShoppingCart, permission: 'procurement:manage', run: () => open(`/purchasing/orders/new?supplierId=${supplier.id}`) },
            { id: 'statement', label: 'contacts.suppliers.menu.statement', icon: ScrollText, permission: 'accounting:view', run: () => open(`/accounting/partner-ledger?type=supplier&partnerId=${supplier.id}`) },
          ],
        },
        {
          id: 'record',
          items: [
            { id: 'edit', label: 'contacts.suppliers.edit', icon: Pencil, permission: 'suppliers:edit', run: () => open(`/contacts/suppliers/${supplier.id}/edit`) },
            { id: 'delete', label: 'contacts.suppliers.delete', icon: Trash2, danger: true, permission: 'suppliers:delete', run: () => this.deleteSupplier(supplier) },
          ],
        },
        { id: 'list', items: [{ id: 'refresh', label: 'actions.refresh', icon: RotateCw, run: () => this.loadSuppliers() }] },
      ];
    },
  };

  /** Sortable by its headers (QA B-01). */
  readonly table = sortable(() => this.suppliers());
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly EditIcon = Edit;
  protected readonly StatementIcon = ScrollText;
  protected readonly TrashIcon = Trash2;

  private suppliersService = inject(SuppliersService);
  private notificationService = inject(NotificationService);
  private readonly safeDelete = inject(SafeDeleteService);

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

  /**
   * Deleting asks first what still uses the supplier (QA A-08). Suppliers have no inactive state,
   * so one that bills or orders name is explained, not offered a delete that would fail.
   */
  async deleteSupplier(supplier: Supplier): Promise<void> {
    const outcome = await this.safeDelete.run({
      name: supplier.name,
      check: () => this.suppliersService.dependents(supplier.id),
      remove: () => this.suppliersService.deleteSupplier(supplier.id),
      keys: {
        confirmTitle: 'dialog.delete_supplier.title',
        confirmMessage: 'dialog.delete_supplier.message_named',
        deleted: 'contacts.suppliers.supplier_deleted',
        deleteFailed: 'contacts.suppliers.supplier_could_not_deleted',
        blockedTitle: 'contacts.suppliers.delete_blocked_title',
        blockedMessage: 'contacts.suppliers.delete_blocked_message',
      },
    });
    if (outcome !== 'cancelled') this.loadSuppliers();
  }
}
