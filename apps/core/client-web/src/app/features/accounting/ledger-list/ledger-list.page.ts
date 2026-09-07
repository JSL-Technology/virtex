import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, PlusCircle } from 'lucide-angular';
import { LedgersService } from '../../../core/api/ledgers.service';
import { Ledger } from '../../../core/models/ledger.model';
import { ListShellComponent } from '../../../shared/components/gestures';

/**
 * Los libros contables.
 *
 * ## Qué era esta página
 *
 * Marcado de DaisyUI —`btn-ghost`, `badge-success`, `hover`, `w-1`— en una aplicación que no carga
 * Tailwind ni DaisyUI, así que ninguna de esas clases hacía nada. Dos de las tres columnas estaban
 * COMENTADAS en la plantilla: la descripción y el indicador de libro por defecto se pedían al
 * servidor, viajaban por la red y no se dibujaban. Vuelven a verse.
 *
 * El observable pasa a señales porque el armazón necesita saber si está cargando y si falló, y un
 * `| async` no puede decir ninguna de las dos cosas: mientras cargaba, la tabla se veía vacía, y si
 * el servidor fallaba, se veía vacía también.
 */
@Component({
  selector: 'app-ledger-list-page',
  standalone: true,
  imports: [RouterLink, LucideAngularModule, TranslateModule, ListShellComponent],
  templateUrl: './ledger-list.page.html',
  styleUrls: ['./ledger-list.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LedgerListPage implements OnInit {
  private ledgersService = inject(LedgersService);

  protected readonly CreateIcon = PlusCircle;

  readonly ledgers = signal<Ledger[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.ledgersService.getLedgers().subscribe({
      next: (ledgers) => {
        this.ledgers.set(ledgers);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('ACCOUNTING.LEDGER_LIST.LOAD_FAILED');
        this.loading.set(false);
      },
    });
  }
}
