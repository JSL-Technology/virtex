import { Injectable, signal } from '@angular/core';

const PREVIEW_KEY = 'virtex.tabs.enablePreview';

/**
 * Preferencias del área de trabajo que el usuario controla, persistidas en
 * `localStorage` (como `WindowModeService`). Hoy solo la vista previa; es el
 * punto donde se irán colgando futuras opciones de comportamiento de pestañas.
 *
 * ## Vista previa (estilo VS Code)
 *
 * Con la vista previa activada, abrir un registro no crea una pestaña nueva cada
 * vez: reutiliza una única pestaña «efímera» (en cursiva) hasta que el usuario la
 * fija —editándola, con doble clic en su cabecera o desde el menú—. Es lo que
 * evita que curiosear por veinte documentos deje veinte pestañas abiertas.
 *
 * Se puede desactivar para quien prefiera que cada apertura sea permanente
 * (equivalente a `workbench.editor.enablePreview` de VS Code).
 */
@Injectable({ providedIn: 'root' })
export class TabPreferencesService {
  private readonly enablePreviewSignal = signal<boolean>(restoreBool(PREVIEW_KEY, true));

  /** ¿Los registros se abren en vista previa reutilizable? (por defecto sí). */
  readonly enablePreview = this.enablePreviewSignal.asReadonly();

  setEnablePreview(value: boolean): void {
    this.enablePreviewSignal.set(value);
    persistBool(PREVIEW_KEY, value);
  }

  toggleEnablePreview(): void {
    this.setEnablePreview(!this.enablePreviewSignal());
  }
}

function restoreBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

function persistBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Modo privado / almacenamiento bloqueado: se pierde entre sesiones y ya está.
  }
}
