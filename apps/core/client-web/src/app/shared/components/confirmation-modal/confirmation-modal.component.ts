import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * A confirm/cancel dialog whose every visible string is a translation key.
 *
 * The inputs take keys, not prose, and the template resolves them. That is the only arrangement
 * that survives a language change while the dialog is open, and it keeps the call site free of
 * text: a page asking "are you sure?" names the question, it does not spell it.
 *
 * Three defects are fixed here, all of them silent:
 *
 *   - `confirmText`, `cancelText` and the variant were passed by the one call site but were not
 *     inputs, so the buttons always read `Confirmar` / `Cancelar` no matter what the caller asked
 *     for, and the destructive action was never painted as destructive.
 *   - The outputs were `confirmed`/`cancelled` while the call site bound `(confirm)`/`(cancel)`.
 *     Angular resolved those to native DOM events that nothing dispatches, so the buttons emitted
 *     into the void: confirming "disable two-factor authentication" did nothing at all.
 *   - The template was styled in Tailwind utilities, which this workspace does not build. See the
 *     stylesheet.
 */
@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./confirmation-modal.component.scss'],
  template: `
    @if (isOpen) {
      <!-- Backdrop dismiss is a mouse convenience; the keyboard equivalent is Escape, handled on
           the document, so a keyboard reader is never left without a way out. See onEscapeKey().
           Both rules are waived here rather than answered literally: a key handler on this <div>
           could never fire (it takes no focus), and making it focusable would put a full-screen
           tab stop in front of the dialog — worse for exactly the users the rules protect. -->
      <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus, @angular-eslint/template/click-events-have-key-events -->
      <div class="cm-overlay" (click)="$event.target === $event.currentTarget && onCancel()">
        <div class="cm-box" role="alertdialog" aria-modal="true"
             [attr.aria-label]="title | translate"
             [attr.aria-describedby]="'confirmation-modal-message'">
          <div class="cm-body">
            <h3 class="cm-title">{{ title | translate }}</h3>
            <p class="cm-message" id="confirmation-modal-message">{{ message | translate }}</p>

            <div class="cm-actions">
              <button type="button" class="cm-button cm-button--cancel" (click)="onCancel()">
                {{ cancelText | translate }}
              </button>
              <button type="button" class="cm-button"
                      [class.cm-button--danger]="variant === 'danger'"
                      [class.cm-button--confirm]="variant !== 'danger'"
                      (click)="onConfirm()">
                {{ confirmText | translate }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmationModalComponent {
  @Input() isOpen = false;

  /** Translation keys, resolved by the template — never prose. */
  @Input() title = 'COMMON.CONFIRMATION';
  @Input() message = 'COMMON.ARE_YOU_SURE';
  @Input() confirmText = 'COMMON.CONFIRM';
  @Input() cancelText = 'COMMON.CANCEL';

  /** `danger` paints the confirm button red; anything destructive should look destructive. */
  @Input() variant: 'default' | 'danger' = 'default';

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  onConfirm(): void {
    this.confirmed.emit();
  }

  onCancel(): void {
    this.cancelled.emit();
  }

  /**
   * Escape closes the dialog.
   *
   * Handled at the document level so it works wherever focus happens to be. Satisfying the
   * template linter by putting `tabindex="0"` and `role="button"` on the backdrop instead would
   * have added a phantom tab stop in front of the dialog — a worse experience for exactly the
   * users the rule exists to protect.
   */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen) this.onCancel();
  }
}
