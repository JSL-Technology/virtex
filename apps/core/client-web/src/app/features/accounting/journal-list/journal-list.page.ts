import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { JournalsService } from '../../../core/api/journals.service';
import { Journal } from '../../../core/models/journal.model';
import { ListShellComponent } from '../../../shared/components/gestures';

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
  imports: [RouterLink, TranslateModule, LucideAngularModule, ListShellComponent],
  templateUrl: './journal-list.page.html',
  styleUrls: ['./journal-list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JournalListPage implements OnInit {
  private journalsService = inject(JournalsService);

  protected readonly PlusCircleIcon = PlusCircle;

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
      error: () => {
        this.error.set('ACCOUNTING.JOURNAL_LIST.LOAD_FAILED');
        this.loading.set(false);
      },
    });
  }
}
