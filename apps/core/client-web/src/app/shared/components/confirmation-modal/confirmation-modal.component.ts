
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-confirmation-modal',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  template: `
    <div class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
         *ngIf="isOpen"
         (click)="onCancel()">

      <div class="w-full max-w-sm bg-white dark:bg-card-bg rounded-xl shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-800"
           (click)="$event.stopPropagation()">

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

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onConfirm() {
    this.confirm.emit();
  }

  onCancel() {
    this.cancel.emit();
  }
}
