import { Component, ChangeDetectionStrategy, inject, HostListener, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule, AlertTriangle, Info, ShieldAlert, Save, Trash2, X,
} from 'lucide-angular';
import { DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dialog(); as d) {
      <!-- Backdrop dismiss is a mouse convenience; Escape is handled at the document level in the component. See onEscapeKey(). -->
      <!-- eslint-disable-next-line @angular-eslint/template/interactive-supports-focus -->
      <div class="dialog-overlay"
           (click)="$event.target === $event.currentTarget && onBackdrop()"
           (keydown.escape)="onBackdrop()">
        <div
          class="dialog-card"
          [class.variant-danger]="d.variant === 'danger'"
          [class.variant-warning]="d.variant === 'warning'"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="d.title"

        >
          <button class="dialog-close" type="button" [attr.aria-label]="'COMMON.CLOSE' | translate" (click)="cancel()">
            <lucide-icon [img]="XIcon" size="18"></lucide-icon>
          </button>

          <div class="dialog-icon">
            <lucide-icon [img]="iconFor(d.variant)" size="24"></lucide-icon>
          </div>

          <h3 class="dialog-title">{{ d.title }}</h3>
          <p class="dialog-message">{{ d.message }}</p>

          @if (d.kind === 'prompt') {
            <label class="dialog-field">
              <span class="sr-only">{{ d.message }}</span>
              <input
                #promptInput
                class="dialog-input"
                type="text"
                autocomplete="off"
                [attr.placeholder]="d.placeholder || null"
                [value]="draft()"
                (input)="draft.set(promptInput.value)"
                (keydown.enter)="submitPrompt()"
              />
            </label>
            @if (promptError()) {
              <p class="dialog-error" role="alert">{{ d.tooShort }}</p>
            }
          }

          <div class="dialog-actions">
            @if (d.kind === 'close') {
              <button class="btn btn-ghost" type="button" (click)="resolve('cancel')">
                {{ d.cancelText }}
              </button>
              <button class="btn btn-danger-soft" type="button" (click)="resolve('discard')">
                <lucide-icon [img]="Trash2Icon" size="16"></lucide-icon>
                {{ d.discardText }}
              </button>
              <button class="btn btn-primary" type="button" (click)="resolve('save')">
                <lucide-icon [img]="SaveIcon" size="16"></lucide-icon>
                {{ d.saveText }}
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
          </div>
        </div>
      </div>
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
  protected readonly XIcon = X;

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
    this.resolve(d.kind === 'close' ? 'cancel' : d.kind === 'prompt' ? null : false);
  }

  onBackdrop(): void {
    // Backdrop click is treated as a non-destructive cancel.
    this.cancel();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancel();
  }
}
