import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { VxDialogComponent } from '../dialog';

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
  imports: [TranslateModule, VxDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./confirmation-modal.component.scss'],
  template: `
    @if (isOpen) {
      <!--
        «vx-dialog» pone el velo, el Escape y la trampa de foco. Lo que había era ese armazón
        reimplementado, con dos reglas de accesibilidad silenciadas a mano para poder hacerlo —y
        sin trampa, que es lo que esas reglas intentaban proteger.

        Sigue siendo «alertdialog» y no «dialog»: interrumpe para pedir una decisión, y el foco
        entra en el botón que NO destruye nada.
      -->
      <vx-dialog
        size="sm"
        [title]="title | translate"
        [hideCloseButton]="true"
        (dismissed)="onCancel()"
      >
        <p class="cm-message" id="confirmation-modal-message">{{ message | translate }}</p>

        <ng-container dialogActions>
          <button type="button" cdkFocusInitial class="cm-button cm-button--cancel" (click)="onCancel()">
            {{ cancelText | translate }}
          </button>
          <button
            type="button"
            class="cm-button"
            [class.cm-button--danger]="variant === 'danger'"
            [class.cm-button--confirm]="variant !== 'danger'"
            (click)="onConfirm()"
          >
            {{ confirmText | translate }}
          </button>
        </ng-container>
      </vx-dialog>
    }
  `,
})
export class ConfirmationModalComponent {
  @Input() isOpen = false;

  /** Translation keys, resolved by the template — never prose. */
  @Input() title = 'common.confirmation';
  @Input() message = 'common.are_you_sure';
  @Input() confirmText = 'common.confirm';
  @Input() cancelText = 'common.cancel';

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
}
