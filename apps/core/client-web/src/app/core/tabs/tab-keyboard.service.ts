import { Injectable, inject } from '@angular/core';
import { ShortcutsService } from '../keyboard/shortcuts.service';
import { TabCommandsService } from './tab-command.service';
import { SHORTCUT_DEFINITIONS } from '../keyboard/keyboard-shortcuts';

/**
 * Atajos de teclado del área de trabajo, al estilo de un editor de pestañas.
 *
 * En la web son todos `Alt+Shift` + tecla (cerrar `Alt+Shift+W`, reabrir `Alt+Shift+T`, siguiente
 * y anterior `Alt+Shift+AvPág/RePág`); en la app de escritorio, los clásicos `Ctrl/Cmd+W`,
 * `Ctrl/Cmd+Shift+T` y `Ctrl+Tab`. Ver `SHORTCUT_DEFINITIONS` (QA A-14).
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
 * En un navegador son del navegador: Ctrl+W cierra la PESTAÑA DEL NAVEGADOR y no se puede
 * interceptar. Por eso solo son los atajos por defecto en el escritorio. Se hace `preventDefault`
 * solo cuando el atajo se atiende. Mientras el editor de atajos captura una tecla, `capturing` está
 * activo y este oyente —que escucha en fase de CAPTURA sobre `window`, antes que nadie— se aparta.
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
