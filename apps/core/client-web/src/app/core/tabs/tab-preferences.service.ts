import { Injectable, signal } from '@angular/core';

const PREVIEW_KEY = 'virtex.tabs.enablePreview';
const MAX_TABS_KEY = 'virtex.tabs.max';

/** The tab limits the user can pick. 12 is the default: enough to work, few enough to read. */
export const TAB_LIMIT_CHOICES = [8, 12, 20] as const;
export const DEFAULT_MAX_TABS = 12;

/**
 * Preferencias del área de trabajo que el usuario controla, persistidas en
 * `localStorage` (como `WindowModeService`). Hoy solo la vista previa; es el
 * punto donde se irán colgando futuras opciones de comportamiento de pestañas.
 *
 * ## Vista previa (estilo VS Code)
 *
 * Con la vista previa activada, abrir un módulo o un registro no crea una pestaña nueva cada
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

  /**
   * How many tabs stay open before the least recently used one is closed for a new one (QA A-04).
   *
   * Without a working cap a few days of normal use left 40 tabs open: titles cut to «Exist…», and
   * every hidden page kept its requests alive.
   */
  private readonly maxTabsSignal = signal<number>(restoreLimit());
  readonly maxTabs = this.maxTabsSignal.asReadonly();

  setMaxTabs(value: number): void {
    const next = (TAB_LIMIT_CHOICES as readonly number[]).includes(value) ? value : DEFAULT_MAX_TABS;
    this.maxTabsSignal.set(next);
    try {
      localStorage.setItem(MAX_TABS_KEY, String(next));
    } catch {
      // Almacenamiento bloqueado: vale para esta sesión.
    }
  }

  setEnablePreview(value: boolean): void {
    this.enablePreviewSignal.set(value);
    persistBool(PREVIEW_KEY, value);
  }

  toggleEnablePreview(): void {
    this.setEnablePreview(!this.enablePreviewSignal());
  }
}

function restoreLimit(): number {
  try {
    const raw = Number(localStorage.getItem(MAX_TABS_KEY));
    return (TAB_LIMIT_CHOICES as readonly number[]).includes(raw) ? raw : DEFAULT_MAX_TABS;
  } catch {
    return DEFAULT_MAX_TABS;
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
