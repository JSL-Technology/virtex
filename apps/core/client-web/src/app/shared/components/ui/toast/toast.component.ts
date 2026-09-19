import { Component, inject, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Toast } from '../../../interfaces/toast.interface';
import { LucideAngularModule, CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { trigger, style, animate, transition } from '@angular/animations';
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
  private readonly router = inject(Router);

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

  /**
   * The progress bar is drawn only while the toast is on a timer. A pinned toast (`duration` of
   * `0`, or none) has no time to show draining, so it shows no bar.
   */
  public showProgress = computed(() => (this.toast().duration ?? 0) > 0);

  close() {
    this.closed.emit(this.toast().id);
  }

  /**
   * Run the toast's action, then close it.
   *
   * The button carries the reader where the message points: a normal navigation via `commands`, or
   * — for the settings overlay — the URL fragment set on whatever page they are on now, so closing
   * the overlay returns them here. Closing after acting is deliberate: the message has done its job
   * the moment the reader takes it up, and a toast left behind the screen it sent them to is litter.
   */
  protected runAction(): void {
    const action = this.toast().action;
    if (!action) return;

    action.handler?.();

    if (action.fragment !== undefined) {
      // Preserve the current path and query, changing only the fragment — this is what opens the
      // settings modal without navigating the reader away from their work.
      const tree = this.router.parseUrl(this.router.url);
      tree.fragment = action.fragment;
      void this.router.navigateByUrl(tree);
    } else if (action.commands?.length) {
      void this.router.navigate(action.commands, { queryParams: action.queryParams });
    }

    this.close();
  }

  protected onEnter(): void {
    this.hold.emit(this.toast().id);
  }

  protected onLeave(): void {
    this.release.emit(this.toast().id);
  }
}
