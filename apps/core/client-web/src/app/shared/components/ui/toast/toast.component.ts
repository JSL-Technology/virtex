import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Toast } from '../../../interfaces/toast.interface';
import { LucideAngularModule, CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { trigger, state, style, animate, transition } from '@angular/animations';
import { composeKey } from '@virteex/shared/types';

@Component({
  selector: 'app-toast',
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.scss',
  animations: [
    trigger('toastAnimation', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms cubic-bezier(0.4, 0, 0.2, 1)', style({ transform: 'translateX(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('200ms cubic-bezier(0.4, 0, 1, 1)', style({ transform: 'translateX(100%)', opacity: 0 }))
      ])
    ])
  ],
  host: {
    '[@toastAnimation]': '',
    // Pointer and keyboard alike: a toast reached by Tab is being read just as much as one
    // under the cursor.
    '(mouseenter)': 'onEnter()',
    '(mouseleave)': 'onLeave()',
    '(focusin)': 'onEnter()',
    '(focusout)': 'onLeave()',
  }
})
export class ToastComponent {
  public toast = input.required<Toast>();
  public closed = output<string>();
  /**
   * Raised while the reader is engaged with this toast, and again when they leave.
   *
   * Hovering or tabbing to a toast is a reader saying "I am reading this", and a message that
   * disappears mid-sentence because a timer started before they got there is a message lost. The
   * countdown is the service's, so the component reports the intent rather than owning the timer.
   */
  public hold = output<string>();
  public release = output<string>();

  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly XCircleIcon = XCircle;
  protected readonly AlertCircleIcon = AlertCircle;
  protected readonly InfoIcon = Info;
  protected readonly XIcon = X;

  public icon = computed(() => {
    switch (this.toast().type) {
      case 'success': return this.CheckCircleIcon;
      case 'error': return this.XCircleIcon;
      case 'warning': return this.AlertCircleIcon;
      case 'info': return this.InfoIcon;
      default: return this.InfoIcon;
    }
  });

  public typeClass = computed(() => `toast-${this.toast().type}`);

  public titleKey = computed(() => {
    return composeKey('common.toast', this.toast().type);
  });

  close() {
    this.closed.emit(this.toast().id);
  }

  protected onEnter(): void {
    this.hold.emit(this.toast().id);
  }

  protected onLeave(): void {
    this.release.emit(this.toast().id);
  }
}
