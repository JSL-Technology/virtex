import { Injectable, inject } from '@angular/core';
import { TabStateService } from './tab-state.service';

/**
 * Atajos de teclado del área de trabajo, al estilo de un editor de pestañas.
 *
 *  - `Ctrl/Cmd+W`            cerrar la pestaña activa
 *  - `Ctrl/Cmd+Shift+T`      reabrir la última pestaña cerrada
 *  - `Ctrl+Tab` / `+Shift`   siguiente / anterior pestaña
 *  - `Ctrl+PageDown/PageUp`  siguiente / anterior pestaña
 *
 * ## Sobre `Ctrl/Cmd+W` y `Ctrl+Tab`
 *
 * En un navegador el propio agente puede reservarse estas combinaciones (cerrar
 * pestaña del navegador, cambiar de pestaña del navegador) y no siempre se pueden
 * interceptar. En la app de escritorio y en modo instalado (PWA standalone) sí
 * funcionan, que es donde el usuario trabaja como en un escritorio. Se hace
 * `preventDefault` solo cuando el atajo se atiende, para no estorbar al resto.
 */
@Injectable({ providedIn: 'root' })
export class TabKeyboardService {
  private tabState = inject(TabStateService);
  private started = false;

  init(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    window.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;

    const key = event.key;

    // Ctrl/Cmd+Shift+T → reabrir la última cerrada.
    if ((key === 't' || key === 'T') && event.shiftKey) {
      this.tabState.reopenLastClosed();
      event.preventDefault();
      return;
    }

    // Ctrl/Cmd+W → cerrar la activa (sin Shift, para no chocar con «cerrar ventana»).
    if ((key === 'w' || key === 'W') && !event.shiftKey) {
      this.tabState.closeActive();
      event.preventDefault();
      return;
    }

    // Ctrl+Tab / Ctrl+Shift+Tab → ciclar pestañas.
    if (key === 'Tab') {
      this.tabState.activateRelative(event.shiftKey ? -1 : 1);
      event.preventDefault();
      return;
    }

    // Ctrl+PageDown / Ctrl+PageUp → siguiente / anterior.
    if (key === 'PageDown') {
      this.tabState.activateRelative(1);
      event.preventDefault();
      return;
    }
    if (key === 'PageUp') {
      this.tabState.activateRelative(-1);
      event.preventDefault();
    }
  };
}
