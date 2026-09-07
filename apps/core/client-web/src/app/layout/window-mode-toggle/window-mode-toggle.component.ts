import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Square, LayoutGrid, Smartphone } from 'lucide-angular';
import { WindowModeService } from '../../core/windows/window-mode.service';

/**
 * Elegir cómo se disponen las ventanas internas.
 *
 * ## Por qué es un botón y no un ajuste enterrado
 *
 * Porque no es una preferencia que se elige una vez: se cambia con la tarea. Facturar veinte
 * documentos quiere una ventana; conciliar un extracto contra el mayor quiere dos a la vista. Un
 * conmutador escondido en Configuración obliga a cambiar de contexto para cambiar de disposición,
 * que es justo lo contrario de lo que se está intentando hacer.
 *
 * En pantalla estrecha el botón se muestra deshabilitado y dice por qué, en vez de desaparecer:
 * un control que se esfuma sin explicación se lee como una avería, y quien lo buscaba en el
 * escritorio volvería a buscarlo aquí.
 */
@Component({
  selector: 'app-window-mode-toggle',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="icon-button wm"
      [class.wm--on]="mode() === 'workshop'"
      [disabled]="mode() === 'compact'"
      [attr.aria-pressed]="mode() === 'workshop'"
      [title]="label() | translate"
      [attr.aria-label]="'TABS.MODE' | translate"
      (click)="modes.toggle()"
    >
      <lucide-icon [img]="icon()" size="18" aria-hidden="true"></lucide-icon>
    </button>
  `,
  styles: [
    `
      .wm--on {
        background-color: var(--accent-surface);
        color: var(--accent-solid);
      }

      .wm:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }
    `,
  ],
})
export class WindowModeToggleComponent {
  protected readonly modes = inject(WindowModeService);

  protected readonly mode = this.modes.mode;

  protected readonly icon = computed(() => {
    switch (this.mode()) {
      case 'workshop':
        return LayoutGrid;
      case 'compact':
        return Smartphone;
      default:
        return Square;
    }
  });

  /** Qué dice el `title`: el modo actual y qué significa, no solo su nombre. */
  protected readonly label = computed(() => {
    switch (this.mode()) {
      case 'workshop':
        return 'TABS.MODE_WORKSHOP_HINT';
      case 'compact':
        return 'TABS.MODE_COMPACT_HINT';
      default:
        return 'TABS.MODE_FOCUSED_HINT';
    }
  });
}
