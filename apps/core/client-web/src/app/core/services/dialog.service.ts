import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

/** Visual emphasis for a confirm dialog's primary action. */
export type DialogVariant = 'primary' | 'danger' | 'warning';

/** Result of a three-way "unsaved changes" prompt. */
export type CloseDecision = 'save' | 'discard' | 'cancel';

export interface ConfirmDialogConfig {
  /** Translation keys — never prose. Resolved by the service before the host renders them. */
  title: string;
  message: string;
  /** Parameters for `message`, for the many confirmations that name the record they affect. */
  messageParams?: Record<string, unknown>;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  icon?: string; // lucide icon name
}

export interface PromptConfig {
  /** Translation keys — never prose. */
  title: string;
  message: string;
  messageParams?: Record<string, unknown>;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: DialogVariant;
  icon?: string;
  /** Reject anything shorter than this, with `tooShort` as the reason shown. */
  minLength?: number;
  tooShort?: string;
}

export interface ConfirmCloseConfig {
  /** Translation keys — never prose. */
  title?: string;
  message?: string;
  /**
   * Parameters for `message`.
   *
   * The type said "translation keys — never prose" and had no way to name the record the dialog is
   * about, so the one caller that needed to —closing a tab with unsaved changes— passed a Spanish
   * sentence built with a template literal instead.
   */
  messageParams?: Record<string, unknown>;
  saveText?: string;
  discardText?: string;
  cancelText?: string;
  /**
   * Whether the "Save" action is offered. Defaults to true. Set false when nothing can act on it —
   * a tab with no registered save handler — so the reader is not shown a button that leads nowhere.
   */
  allowSave?: boolean;
}

type DialogKind = 'confirm' | 'close' | 'prompt' | 'alert';

/**
 * Exported because `DialogHostComponent.dialog` is a public property of its type, and a
 * declaration emit cannot name a type it cannot import (TS4029).
 */
export interface ActiveDialog {
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
  /** Whether the close dialog offers "Save" (false when the tab has no save handler). */
  allowSave: boolean;
  // prompt
  placeholder: string;
  minLength: number;
  tooShort: string;
  resolve: (value: boolean | CloseDecision | string | null) => void;
}

/**
 * Imperative, promise-based dialog service. Replaces `window.confirm` so that the app keeps a
 * single, themed dialog surface (see TAB_ARCHITECTURE §7.2).
 *
 * The rendering lives in DialogHostComponent, mounted once in MainLayout, which reacts to the
 * `active` signal exposed here.
 *
 * ## Keys, not prose
 *
 * Callers pass translation keys and this service resolves them. It used to take resolved strings
 * and carry Spanish defaults — `'Aceptar'`, `'Cancelar'`, `'Cambios sin guardar'` — so a reader in
 * English got English text on a dialog with Spanish buttons, which is worse than either language
 * alone. Resolving here means one lookup in one place and no caller can pass a literal by
 * accident, because a literal would show up on screen as itself.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly _active = signal<ActiveDialog | null>(null);
  readonly active = this._active.asReadonly();
  private readonly translate = inject(TranslateService);

  private t(key: string, params?: Record<string, unknown>): string {
    return this.translate.instant(key, params);
  }

  /**
   * Tell the reader something that has already happened. One button, nothing to decide.
   *
   * ## Why this had to exist
   *
   * Because something was already using a dialog to say "your session was ended", and the thing
   * it was using — `ModalService` — threw `TypeError` on every call: it subscribed to
   * `onConfirm`/`onCancel`/`onCloseModal` while `ModalComponent` declared
   * `confirmed`/`cancelled`/`closed`. So the notice a user gets when they are forcibly signed out
   * was never shown; they were simply thrown to the sign-in page with no reason given.
   *
   * `confirm()` would have been the wrong home for it: a message with nothing to decide must not
   * offer "Cancel", because a cancel button implies there is something to call off.
   *
   * The message here is PROSE, not a key. The one real caller relays a reason the server wrote
   * and already localised; looking that up in the client's catalogue would print the key back.
   */
  alert(config: { title: string; message: string; acceptText?: string; variant?: DialogVariant }): Promise<void> {
    return new Promise<void>((resolve) => {
      this._active.set({
        kind: 'alert',
        title: this.t(config.title),
        message: config.message,
        variant: config.variant ?? 'primary',
        confirmText: this.t(config.acceptText ?? 'common.accept'),
        cancelText: '',
        saveText: '',
        discardText: '',
        allowSave: false,
        placeholder: '',
        minLength: 0,
        tooShort: '',
        resolve: () => resolve(),
      });
    });
  }

  /** Simple yes/no confirmation. Resolves true when confirmed. */
  confirm(config: ConfirmDialogConfig): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._active.set({
        kind: 'confirm',
        title: this.t(config.title),
        message: this.t(config.message, config.messageParams),
        variant: config.variant ?? 'primary',
        icon: config.icon,
        confirmText: this.t(config.confirmText ?? 'common.accept'),
        cancelText: this.t(config.cancelText ?? 'common.cancel'),
        saveText: '',
        discardText: '',
        allowSave: false,
        placeholder: '',
        minLength: 0,
        tooShort: '',
        resolve: (v) => resolve(v as boolean),
      });
    });
  }

  /** Three-way prompt for closing a tab with unsaved changes. */
  confirmClose(config: ConfirmCloseConfig = {}): Promise<CloseDecision> {
    return new Promise<CloseDecision>((resolve) => {
      this._active.set({
        kind: 'close',
        title: this.t(config.title ?? 'dialog.unsaved_changes.title'),
        message: this.t(config.message ?? 'dialog.unsaved_changes.message', config.messageParams),
        variant: 'warning',
        icon: 'TriangleAlert',
        confirmText: '',
        cancelText: this.t(config.cancelText ?? 'common.cancel'),
        saveText: this.t(config.saveText ?? 'common.save'),
        discardText: this.t(config.discardText ?? 'common.discard'),
        allowSave: config.allowSave !== false,
        placeholder: '',
        minLength: 0,
        tooShort: '',
        resolve: (v) => resolve(v as CloseDecision),
      });
    });
  }

  /**
   * Ask for a line of text — a reason, a justification.
   *
   * This replaces `window.prompt`, which two places used to ask why a fiscal period was being
   * reopened and why a supplier bill was being voided: text the auditor eventually reads, gathered
   * through a dialog the product cannot style, cannot validate and that several browsers refuse to
   * show at all — in which case `prompt` returns null and the action silently does not happen.
   *
   * Resolves to the trimmed text, or null if the reader cancelled.
   */
  prompt(config: PromptConfig): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      this._active.set({
        kind: 'prompt',
        title: this.t(config.title),
        message: this.t(config.message, config.messageParams),
        variant: config.variant ?? 'primary',
        icon: config.icon,
        confirmText: this.t(config.confirmText ?? 'common.accept'),
        cancelText: this.t(config.cancelText ?? 'common.cancel'),
        saveText: '',
        discardText: '',
        allowSave: false,
        placeholder: config.placeholder ? this.t(config.placeholder) : '',
        minLength: config.minLength ?? 0,
        tooShort: config.tooShort ? this.t(config.tooShort) : '',
        resolve: (v) => resolve(typeof v === 'string' ? v : null),
      });
    });
  }

  /** Called by the host when the user picks an option. */
  resolveActive(value: boolean | CloseDecision | string | null): void {
    const current = this._active();
    if (!current) return;
    this._active.set(null);
    current.resolve(value);
  }
}
