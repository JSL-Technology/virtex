import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle, Trash2 } from 'lucide-angular';
import { JournalsService } from '../../../core/api/journals.service';
import { Journal } from '../../../core/models/journal.model';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent } from '../../../shared/components/badge';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';

/**
 * Los diarios contables.
 *
 * ## Qué era esta página
 *
 * Marcado de Bootstrap —`container-fluid`, `row`, `col-12`, `card-header`, `btn btn-primary`— e
 * iconos de Font Awesome (`<i class="fas fa-plus">`), en una aplicación que no carga ninguna de las
 * dos bibliotecas. Es decir: la pantalla se veía sin estilo y el icono no existía. Nadie lo decidió;
 * es lo que pasa cuando cada página elige su propio vocabulario y nada comprueba cuál se usa.
 *
 * Tampoco tenía estado de carga ni de error: la suscripción escribía la lista y, si el servidor
 * fallaba, la tabla se quedaba vacía sin decir por qué —que se lee como «no hay diarios».
 */
@Component({
  selector: 'app-journal-list',
  standalone: true,
  imports: [RouterLink, TranslateModule, LucideAngularModule, ListShellComponent, VxBadgeComponent],
  templateUrl: './journal-list.page.html',
  styleUrls: ['./journal-list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalListPage implements OnInit {
  private journalsService = inject(JournalsService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);

  protected readonly PlusCircleIcon = PlusCircle;
  protected readonly TrashIcon = Trash2;

  readonly journals = signal<Journal[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.journalsService.getJournals().subscribe({
      next: (journals) => {
        this.journals.set(journals);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'accounting.journal_list.load_failed'));
        this.loading.set(false);
      },
    });
  }

  typeKey(journal: Journal): string {
    return `accounting.journal_type.${journal.type.toLowerCase()}`;
  }

  /** Deletable only while nothing was posted to it, and never one the product posts to itself. */
  canDelete(journal: Journal): boolean {
    return !journal.isSystem && (journal.entryCount ?? 0) === 0;
  }

  async remove(journal: Journal): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'accounting.journal_list.delete_title',
      message: 'accounting.journal_list.delete_message',
      messageParams: { name: `${journal.code} · ${journal.name}` },
      confirmText: 'common.delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.journalsService.remove(journal.id).subscribe({
      next: () => {
        this.notifications.showSuccess('accounting.journal_list.deleted');
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'accounting.journal_list.delete_failed'),
    });
  }
}
