import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Search, Inbox, AlertTriangle, RotateCw, X } from 'lucide-angular';

/**
 * El gesto LIST: encontrar un conjunto de registros.
 *
 * ## Qué se lleva el armazón y por qué
 *
 * Los cuatro estados de una lista —cargando, error, vacía, con datos— son
 * exactamente los que se olvidan cuando cada página los escribe por su cuenta.
 * De las treinta y cinco listas del producto, unas mostraban «Cargando…» como
 * un párrafo suelto, otras no mostraban nada; el error aparecía dentro de la
 * tabla o desaparecía; el estado vacío faltaba en casi la mitad. Ninguna de
 * esas diferencias fue una decisión de nadie.
 *
 * Aquí la página proyecta su tabla y ya no puede olvidarse: no le corresponde.
 *
 * ## Por qué el error ofrece reintentar y no solo se disculpa
 *
 * Un error de carga es casi siempre transitorio —la red, un token que acaba de
 * renovarse—, y sin un botón la única salida que le queda al usuario es
 * recargar la aplicación entera y perder las demás ventanas abiertas.
 *
 * ## Por qué el estado vacío distingue «no hay nada» de «no hay nada que
 * coincida»
 *
 * Son dos situaciones distintas con dos salidas distintas: crear el primer
 * registro, o quitar el filtro. Enseñar el mismo cartel para las dos es cómo se
 * consigue que alguien concluya que el sistema perdió sus datos.
 */
@Component({
  selector: 'vx-list-shell',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './list-shell.component.html',
  styleUrls: ['./list-shell.component.scss'],
})
export class ListShellComponent {
  /** Clave i18n del título. La ventana ya lleva el nombre; esto es el encabezado de la página. */
  readonly titleKey = input.required<string>();
  readonly subtitleKey = input<string | null>(null);

  /** Número de registros mostrados. `null` lo oculta — no todas las listas lo saben. */
  readonly count = input<number | null>(null);

  readonly loading = input(false);
  /**
   * Qué salió mal, o `null`.
   *
   * Acepta indistintamente una clave i18n (`ACCOUNTING.PERIODS.LOAD_FAILED`) o un mensaje ya
   * localizado del servidor: se pasa por el pipe de traducción, que devuelve intacto lo que no
   * resuelve. Dos entradas para lo mismo obligarían a cada página a elegir, y la mitad elegiría mal.
   */
  readonly error = input<string | null>(null);
  readonly empty = input(false);

  /**
   * Búsqueda. `model()` y no `input`+`output`: el término lo escribe el usuario y lo puede
   * reponer la página al restaurar una vista guardada, y eso son dos direcciones.
   * Ausente si `searchable` es falso.
   */
  readonly searchable = input(false);
  readonly search = model('');
  readonly searchPlaceholderKey = input('SHELL.SEARCH_PLACEHOLDER');

  /** Emite cuando el usuario pide recargar tras un error o desde la barra. */
  readonly reload = output<void>();

  /** Filas del esqueleto de carga. Constante para no crear un array nuevo en cada detección. */
  protected readonly SKELETON = [1, 2, 3, 4, 5, 6] as const;

  protected readonly SearchIcon = Search;
  protected readonly InboxIcon = Inbox;
  protected readonly AlertIcon = AlertTriangle;
  protected readonly ReloadIcon = RotateCw;
  protected readonly ClearIcon = X;

  /**
   * Vacío por un filtro, y no vacío de verdad.
   *
   * La página no tiene que distinguirlo: si hay término de búsqueda y no hay filas, la lista está
   * vacía por culpa del filtro. La salida es quitarlo, no crear un registro.
   */
  protected readonly filtered = computed(() => this.empty() && this.search().trim().length > 0);

  /** Un solo estado a la vez, resuelto aquí para que la plantilla no encadene condiciones. */
  protected readonly state = computed<'loading' | 'error' | 'filtered' | 'empty' | 'content'>(() => {
    if (this.loading()) return 'loading';
    if (this.error()) return 'error';
    if (this.filtered()) return 'filtered';
    if (this.empty()) return 'empty';
    return 'content';
  });

  protected clearSearch(): void {
    this.search.set('');
  }

  protected onSearch(value: string): void {
    this.search.set(value);
  }
}
