import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { BudgetSummary, BudgetsService } from '../data/budgets.service';

/**
 * Budgets (audit H-16): one per month — the target the budget control enforces on postings and
 * the variance report measures against. The server had them; no screen did, and the variance
 * page reported against budgets nobody could create.
 */
@Component({
  selector: 'app-budgets-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent, HasPermissionDirective, RowLinkDirective],
  templateUrl: './budgets.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', '../../../shared/styles/document-form.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BudgetsPage implements OnInit {
  private readonly budgets = inject(BudgetsService);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly AddIcon = PlusCircle;
  protected readonly DeleteIcon = Trash2;

  readonly rows = signal<BudgetSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.budgets.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'budgets.page.load_failed'));
        this.loading.set(false);
      },
    });
  }

  async remove(row: BudgetSummary): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'budgets.page.delete_title',
      message: 'budgets.page.delete_message',
      messageParams: { name: row.name, period: row.period },
      confirmText: 'budgets.page.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.budgets.remove(row.id).subscribe({
      next: () => {
        this.notifications.showSuccess('budgets.page.deleted');
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'budgets.page.delete_failed'),
    });
  }
}
