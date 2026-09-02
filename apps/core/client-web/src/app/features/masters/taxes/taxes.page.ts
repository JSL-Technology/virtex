import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../../core/services/dialog.service';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Filter, MoreHorizontal, Trash2 } from 'lucide-angular';
import { Tax } from '../../../core/models/tax.model';
import { TaxesService } from '../../../core/api/taxes.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

@Component({
  selector: 'app-taxes-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './taxes.page.html',
  styleUrls: ['./taxes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxesPage implements OnInit {
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly FilterIcon = Filter;
  protected readonly MoreHorizontalIcon = MoreHorizontal;
  protected readonly TrashIcon = Trash2;

  private taxesService = inject(TaxesService);
  private notificationService = inject(NotificationService);

  taxes = signal<Tax[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.loadTaxes();
  }

  loadTaxes(): void {
    this.isLoading.set(true);
    this.taxesService.getTaxes().subscribe({
      next: (data) => {
        this.taxes.set(data);
        this.isLoading.set(false);
      },
      error: () => {
        this.notificationService.showError('MASTERS.TAXES.PUDIERON_CARGAR_IMPUESTOS');
        this.isLoading.set(false);
      },
    });
  }

  async deleteTax(tax: Tax): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'DIALOG.DELETE_TAX.TITLE',
      message: 'DIALOG.DELETE_TAX.MESSAGE',
      messageParams: { name: tax.name },
      confirmText: 'COMMON.DELETE',
      variant: 'danger',
    });
    if (confirmed) {
      this.taxesService.deleteTax(tax.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('MASTERS.TAXES.IMPUESTO_ELIMINADO_EXITOSAMENTE');
          this.loadTaxes();
        },
        error: () => this.notificationService.showError('MASTERS.TAXES.ERROR_ELIMINAR_IMPUESTO'),
      });
    }
  }
}