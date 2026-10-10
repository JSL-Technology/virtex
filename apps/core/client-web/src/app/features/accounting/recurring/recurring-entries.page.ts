import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { VxAmountComponent } from '../../../shared/components/amount';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { RecurringEntriesService, RecurringEntry } from '../data/recurring-entries.service';

/**
 * Recurring journal entries (audit H-21): the rent, the insurance amortisation, the accrual — each
 * with what it posts, how often, when it posts next and whether occurrences are waiting to catch
 * up. The server scheduled them; no screen listed, created or paused one.
 */
@Component({
  selector: 'app-recurring-entries-page',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent, VxAmountComponent, HasPermissionDirective, RowLinkDirective],
  templateUrl: './recurring-entries.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecurringEntriesPage implements OnInit {
  private readonly service = inject(RecurringEntriesService);
  private readonly notifications = inject(NotificationService);

  protected readonly NewIcon = PlusCircle;

  readonly rows = signal<RecurringEntry[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.list().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'recurring_entries.page.load_failed'));
        this.loading.set(false);
      },
    });
  }

  frequencyKey(frequency: string): string {
    return `recurring_entries.frequency.${frequency.toLowerCase()}`;
  }
}
