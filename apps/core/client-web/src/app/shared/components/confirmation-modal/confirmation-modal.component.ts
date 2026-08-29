
import { Component, EventEmitter, Input, Output, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <!-- Backdrop dismiss is a mouse convenience; Escape is handled at the document level in the component. See onEscapeKey(). -->
    <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
         *ngIf="isOpen"
         (click)="$event.target === $event.currentTarget && onCancel()"
         (keydown.escape)="onCancel()">

      <div class="w-full max-w-sm bg-white dark:bg-card-bg rounded-xl shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800"
           role="dialog"
           aria-modal="true">

        <div class="p-6 text-center">
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">{{ title | translate }}</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mb-6">{{ message | translate }}</p>

            <div class="flex gap-3 justify-center">
                <button (click)="onCancel()"
                        class="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 font-medium">
                    {{ 'COMMON.CANCEL' | translate }}
                </button>
                <button (click)="onConfirm()"
                        class="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
                    {{ 'COMMON.CONFIRM' | translate }}
                </button>
            </div>
        </div>
      </div>
    </div>
  `
})
export class ConfirmationModalComponent {
  @Input() isOpen = false;
  @Input() title = 'COMMON.CONFIRMATION';
  @Input() message = 'COMMON.ARE_YOU_SURE';

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  onConfirm() {
    this.confirmed.emit();
  }

  onCancel() {
    this.cancelled.emit();
  }

  /**
   * Escape closes the dialog.
   *
   * The backdrop's click handler is a mouse convenience; the keyboard equivalent for a modal is
   * Escape, handled at the document level so it works wherever focus happens to be. Satisfying the
   * template linter by putting `tabindex="0"` and `role="button"` on the backdrop instead would
   * have added a phantom tab stop in front of the dialog — a worse experience for exactly the
   * users the rule exists to protect.
   */
  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isOpen) {
      this.onCancel();
    }
  }

}
