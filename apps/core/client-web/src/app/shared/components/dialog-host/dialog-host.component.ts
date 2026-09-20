import { Component, ChangeDetectionStrategy, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule, AlertTriangle, Info, ShieldAlert, Save, Trash2,
} from 'lucide-angular';
import { DialogService } from '../../../core/services/dialog.service';
import { VxDialogComponent } from '../dialog';

/**
 * Where every confirmation in the product is drawn.
 *
 * ## What changed
 *
 * It used to draw its own overlay: a fixed `div`, a backdrop click, and an Escape listener on the
 * document. What it did not have — and what nothing in this product had — was a focus trap, so
 * with a confirmation open the Tab key walked out of it and into the page behind. Twenty callers
 * of `DialogService` were affected, which is why this one file is where it was worth fixing.
 *
 * `vx-dialog` now provides the surface: trap, focus restore, block-scroll, Escape scoped to the
 * topmost overlay rather than to the document. Everything below is what this host actually has to
 * decide — which buttons a `confirm`, a `close` and a `prompt` carry, and what each resolves to.
 */
@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, VxDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog(); as d) {
      <vx-dialog
        size="sm"
        [title]="d.title"
        [hideCloseButton]="false"
        (dismissed)="cancel()"
      >
        <div
          class="dialog-body"
          [class.variant-danger]="d.variant === 'danger'"
          [class.variant-warning]="d.variant === 'warning'"
        >
          <div class="dialog-icon">
            <lucide-icon [img]="iconFor(d.variant)" size="24"></lucide-icon>
          </div>

          <p class="dialog-message">{{ d.message }}</p>

          @if (d.kind === 'prompt') {
            <label class="dialog-field">
              <span class="sr-only">{{ d.message }}</span>
              <input
                #promptInput
                cdkFocusInitial
                class="dialog-input"
                type="text"
                autocomplete="off"
                [attr.placeholder]="d.placeholder || null"
                [attr.aria-invalid]="promptError() ? 'true' : null"
                [value]="draft()"
                (input)="draft.set(promptInput.value)"
                (keydown.enter)="submitPrompt()"
              />
            </label>
            @if (promptError()) {
              <p class="dialog-error" role="alert">{{ d.tooShort }}</p>
            }
          }
        </div>

        <ng-container dialogActions>
          @if (d.kind === 'close') {
            <button class="btn btn-ghost" type="button" (click)="resolve('cancel')">
              {{ d.cancelText }}
            </button>
            <button class="btn btn-danger-soft" type="button" (click)="resolve('discard')">
              <lucide-icon [img]="Trash2Icon" size="16"></lucide-icon>
              {{ d.discardText }}
            </button>
            <!--
              "Save" only appears when something can act on it. A tab with no registered save
              handler used to show a "Save" button that, when pressed, told the reader to save
              from the view itself and refused to close — a dead end. Now that case shows only
              Discard / Cancel.
            -->
            @if (d.allowSave) {
              <button class="btn btn-primary" type="button" (click)="resolve('save')">
                <lucide-icon [img]="SaveIcon" size="16"></lucide-icon>
                {{ d.saveText }}
              </button>
            }
          } @else if (d.kind === 'alert') {
            <!--
              Un aviso no tiene «cancelar»: no se está preguntando nada. Un botón de cancelar en un
              mensaje que solo informa sugiere que hay algo que deshacer.
            -->
            <button class="btn btn-primary" type="button" (click)="resolve(true)">
              {{ d.confirmText }}
            </button>
          } @else {
            <button class="btn btn-ghost" type="button" (click)="cancel()">
              {{ d.cancelText }}
            </button>
            <button
              class="btn"
              type="button"
              [class.btn-primary]="d.variant === 'primary'"
              [class.btn-danger]="d.variant === 'danger' || d.variant === 'warning'"
              (click)="d.kind === 'prompt' ? submitPrompt() : resolve(true)"
            >
              {{ d.confirmText }}
            </button>
          }
        </ng-container>
      </vx-dialog>
    }
  `,
  styleUrls: ['./dialog-host.component.scss'],
})
export class DialogHostComponent {
  private dialogService = inject(DialogService);
  readonly dialog = this.dialogService.active;

  /** What the reader has typed into a `prompt` dialog. */
  protected readonly draft = signal('');
  protected readonly promptError = signal(false);

  constructor() {
    // A dialog that opened carrying the previous one's text would offer the last reason as the
    // answer to this question.
    effect(() => {
      this.dialog();
      this.draft.set('');
      this.promptError.set(false);
    });
  }

  /**
   * Accept the typed text, or refuse it for being too short.
   *
   * The minimum matters: the server rejects a one-word justification for reopening a closed
   * fiscal period, and finding that out after the dialog has closed loses what was typed.
   */
  protected submitPrompt(): void {
    const dialog = this.dialog();
    if (!dialog) return;
    const value = this.draft().trim();
    if (value.length < Math.max(1, dialog.minLength)) {
      this.promptError.set(true);
      return;
    }
    this.resolve(value);
  }

  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly InfoIcon = Info;
  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly SaveIcon = Save;
  protected readonly Trash2Icon = Trash2;

  iconFor(variant: string) {
    if (variant === 'danger') return this.ShieldAlertIcon;
    if (variant === 'warning') return this.AlertTriangleIcon;
    return this.InfoIcon;
  }

  resolve(value: boolean | 'save' | 'discard' | 'cancel' | string | null): void {
    this.dialogService.resolveActive(value);
  }

  cancel(): void {
    const d = this.dialog();
    if (!d) return;
    if (d.kind === 'alert') return this.resolve(true);
    this.resolve(d.kind === 'close' ? 'cancel' : d.kind === 'prompt' ? null : false);
  }

  /**
   * Un aviso solo se puede aceptar, así que cerrarlo por cualquier vía es aceptarlo.
   *
   * El resto se cancela. Antes esto vivía además en un `@HostListener` sobre el documento, que
   * con dos diálogos encima cerraba los dos: el CDK entrega la tecla al overlay de arriba.
   */
}
