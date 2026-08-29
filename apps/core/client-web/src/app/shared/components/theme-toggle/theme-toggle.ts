import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LucideAngularModule, Monitor, Moon, Sun } from 'lucide-angular';

import { ThemeMode, ThemeService } from '../../../core/services/theme';

interface ThemeOption {
  readonly mode: ThemeMode;
  readonly icon: typeof Sun;
  readonly label: string;
}

/**
 * Selector de tema de tres estados.
 *
 * ── Por qué un grupo de radios y no un botón que cicla ───────────────────────
 * La versión anterior era un único botón que rotaba claro → oscuro → sistema.
 * Tres problemas de uso reales:
 *
 *   · No se podía ir directo al estado deseado. Desde «claro» hasta «sistema»
 *     había que pasar por «oscuro», parpadeando la interfaz entera por el
 *     camino.
 *   · El icono mostraba el estado ACTUAL mientras el tooltip anunciaba el
 *     SIGUIENTE. Icono y texto describían cosas distintas, y el usuario no
 *     tenía forma de saber cuál de los dos leer.
 *   · Para un lector de pantalla era un botón sin estado: se anunciaba
 *     «botón», nunca qué tema estaba activo.
 *
 * Con `role="radiogroup"` el estado activo es explícito visualmente y en el
 * árbol de accesibilidad, y cada opción se alcanza de una sola pulsación.
 */
@Component({
  selector: 'app-theme-toggle',
  standalone: true,
  imports: [LucideAngularModule],
  templateUrl: './theme-toggle.html',
  styleUrls: ['./theme-toggle.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);

  protected readonly options: readonly ThemeOption[] = [
    { mode: 'light', icon: Sun, label: 'Tema claro' },
    { mode: 'dark', icon: Moon, label: 'Tema oscuro' },
    { mode: 'system', icon: Monitor, label: 'Seguir al sistema' },
  ];

  protected select(mode: ThemeMode): void {
    this.theme.setMode(mode);
  }
}
