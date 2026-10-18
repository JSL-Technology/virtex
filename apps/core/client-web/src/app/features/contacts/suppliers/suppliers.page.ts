import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DialogService } from '../../../core/services/dialog.service';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Edit, Trash2, ScrollText } from 'lucide-angular';
import { Supplier } from '../../../core/models/supplier.model';
import { SuppliersService } from '../../../core/api/suppliers.service';
import { NotificationService } from '../../../core/services/notification';
import { SafeDeleteService } from '../../../core/services/safe-delete.service';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { CanOpenDirective } from '../../../core/modules/can-open.directive';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';

@Component({
  selector: 'app-suppliers-page',
  imports: [HasPermissionDirective, RowLinkDirective, ...VX_SORT, CanOpenDirective, RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './suppliers.page.html',
  styleUrls: ['./suppliers.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuppliersPage implements OnInit {
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
