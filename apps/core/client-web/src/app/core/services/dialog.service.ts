import { Injectable, signal } from '@angular/core';

/** Visual emphasis for a confirm dialog's primary action. */
export type DialogVariant = 'primary' | 'danger' | 'warning';

/** Result of a three-way "unsaved changes" prompt. */
export type CloseDecision = 'save' | 'discard' | 'cancel';

export interface ConfirmDialogConfig {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  icon?: string; // lucide icon name
}

export interface ConfirmCloseConfig {
  title?: string;
  message?: string;
  saveText?: string;
  discardText?: string;
  cancelText?: string;
}

type DialogKind = 'confirm' | 'close';

interface ActiveDialog {
  kind: DialogKind;
  title: string;
  message: string;
  variant: DialogVariant;
  icon?: string;
  // confirm
  confirmText: string;
  cancelText: string;
  // close (3-way)
  saveText: string;
  discardText: string;
  resolve: (value: boolean | CloseDecision) => void;
}

/**
 * Imperative, promise-based dialog service. Replaces window.confirm so that the
 * app keeps a single, themed, i18n-friendly dialog surface (see TAB_ARCHITECTURE §7.2).
 *
 * The actual rendering lives in DialogHostComponent, mounted once in MainLayout,
 * which reacts to the `active` signal exposed here.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly _active = signal<ActiveDialog | null>(null);
  readonly active = this._active.asReadonly();

  /** Simple yes/no confirmation. Resolves true when confirmed. */
  confirm(config: ConfirmDialogConfig): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._active.set({
        kind: 'confirm',
        title: config.title,
        message: config.message,
        variant: config.variant ?? 'primary',
        icon: config.icon,
        confirmText: config.confirmText ?? 'Aceptar',
        cancelText: config.cancelText ?? 'Cancelar',
        saveText: '',
        discardText: '',
        resolve: (v) => resolve(v as boolean),
      });
    });
  }

  /** Three-way prompt for closing a tab with unsaved changes. */
  confirmClose(config: ConfirmCloseConfig = {}): Promise<CloseDecision> {
    return new Promise<CloseDecision>((resolve) => {
      this._active.set({
        kind: 'close',
        title: config.title ?? 'Cambios sin guardar',
        message:
          config.message ??
          'Tienes cambios sin guardar. ¿Qué deseas hacer antes de cerrar?',
        variant: 'warning',
        icon: 'TriangleAlert',
        confirmText: '',
        cancelText: config.cancelText ?? 'Cancelar',
        saveText: config.saveText ?? 'Guardar',
        discardText: config.discardText ?? 'Descartar',
        resolve: (v) => resolve(v as CloseDecision),
      });
    });
  }

  /** Called by the host when the user picks an option. */
  resolveActive(value: boolean | CloseDecision): void {
    const current = this._active();
    if (!current) return;
    this._active.set(null);
    current.resolve(value);
  }
}
