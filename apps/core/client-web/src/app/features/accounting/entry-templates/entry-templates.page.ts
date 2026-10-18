import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { ListShellComponent } from '../../../shared/components/gestures';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { NotificationService } from '../../../core/services/notification';
import { EntryTemplate, RecurringEntriesService } from '../data/recurring-entries.service';

/**
 * Journal entry templates (audit H-21): the shape of an entry booked again and again — payroll
 * accruals, monthly allocations — so that posting one is a date and an amount. The server kept
 * them; no screen did.
 */
@Component({
  selector: 'app-entry-templates-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe, LucideAngularModule, ListShellComponent, HasPermissionDirective, RowLinkDirective],
  templateUrl: './entry-templates.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntryTemplatesPage implements OnInit {
  private readonly service = inject(RecurringEntriesService);
  private readonly notifications = inject(NotificationService);

  protected readonly NewIcon = PlusCircle;

  readonly rows = signal<EntryTemplate[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.templates().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'entry_templates.page.load_failed'));
        this.loading.set(false);
      },
    });
  }

  sideCount(template: EntryTemplate, side: 'DEBIT' | 'CREDIT'): number {
    return template.lines.filter((line) => line.type === side).length;
  }
}
