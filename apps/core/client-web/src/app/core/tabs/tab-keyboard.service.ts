import { Injectable, inject } from '@angular/core';
import { ShortcutsService } from '../keyboard/shortcuts.service';
import { TabCommandsService } from './tab-command.service';
import { SHORTCUT_DEFINITIONS } from '../keyboard/keyboard-shortcuts';

/**
 * Atajos de teclado del área de trabajo, al estilo de un editor de pestañas.
 *
 *  - `Ctrl/Cmd+W`            cerrar la pestaña activa
 *  - `Ctrl/Cmd+Shift+T`      reabrir la última pestaña cerrada
 *  - `Ctrl+Tab` / `+Shift`   siguiente / anterior pestaña
 *  - `Ctrl+PageDown/PageUp`  siguiente / anterior pestaña
 *
 * ## Por qué los atajos los resuelve `ShortcutsService` y no este archivo
 *
 * Cerrar y reabrir son REBINDEABLES desde el diálogo de atajos, así que la combinación ya no se
 * codifica aquí: se pregunta al servicio por la vinculación efectiva (`matches`), que además
 * conoce la plataforma (⌘ en Mac, Ctrl fuera). Ciclar pestañas es convención fija (Ctrl+Tab en
 * todas partes; ⌘+Tab es el conmutador del sistema y no se puede interceptar), así que no es
 * editable, pero también se consulta al servicio para que viva una sola definición.
 *
 * ## Sobre `Ctrl/Cmd+W` y `Ctrl+Tab`
 *
 * En un navegador el propio agente puede reservarse estas combinaciones y no siempre se pueden
 * interceptar; en el escritorio y en PWA standalone sí. Se hace `preventDefault` solo cuando el
 * atajo se atiende. Mientras el editor de atajos captura una tecla, `capturing` está activo y este
 * oyente —que escucha en fase de CAPTURA sobre `window`, antes que nadie— se aparta.
 */
@Injectable({ providedIn: 'root' })
export class TabKeyboardService {
  private shortcuts = inject(ShortcutsService);
  private commands = inject(TabCommandsService);
  private started = false;

  /** The tab + layout shortcuts this listener dispatches, read once from the registry. */
  private readonly dispatchable = SHORTCUT_DEFINITIONS.filter(
    (def) => def.groupId === 'tabs' || def.groupId === 'layout',
  );

  init(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // The shortcuts editor is recording a new binding: let it have the keystroke untouched.
    if (this.shortcuts.capturing()) return;

    // One pass over the registry: whichever tab/layout shortcut the chord matches is run on the
    // active tab. Driven by the definitions, so a new tab shortcut needs no change here.
    for (const def of this.dispatchable) {
      if (!this.shortcuts.matches(event, def.id)) continue;
      if (this.commands.run(def.id)) event.preventDefault();
      return;
    }
  };
}
