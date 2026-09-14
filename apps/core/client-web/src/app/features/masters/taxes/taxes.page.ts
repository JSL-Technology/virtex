import { Component, ChangeDetectionStrategy, signal, inject, OnInit } from '@angular/core';
import { DialogService } from '../../../core/services/dialog.service';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';
import { Tax } from '../../../core/models/tax.model';
import { TaxesService } from '../../../core/api/taxes.service';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';

@Component({
  selector: 'app-taxes-page',
  standalone: true,
  imports: [LucideAngularModule, RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, HasPermissionDirective],
  templateUrl: './taxes.page.html',
  styleUrls: ['./taxes.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxesPage implements OnInit {
  private readonly dialog = inject(DialogService);
  protected readonly PlusCircleIcon = PlusCircle;
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
        this.notificationService.showError('masters.taxes.taxes_could_not_loaded');
        this.isLoading.set(false);
      },
    });
  }

  async deleteTax(tax: Tax): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'dialog.delete_tax.title',
      message: 'dialog.delete_tax.message',
      messageParams: { name: tax.name },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (confirmed) {
      this.taxesService.deleteTax(tax.id).subscribe({
        next: () => {
          this.notificationService.showSuccess('masters.taxes.tax_deleted');
          this.loadTaxes();
        },
        error: () => this.notificationService.showError('masters.taxes.error_deleting_tax'),
      });
    }
  }
}