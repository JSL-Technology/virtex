import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  input,
  output,
} from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { LucideAngularModule, X } from 'lucide-angular';
import { TranslateModule } from '@virteex/shared/ui-i18n';

let nextId = 0;

/**
 * The till's modal: focus trapped inside and given to the first field, Escape closes, the title
 * names the dialog for screen readers. Every dialog on the till is this one shell.
 */
@Component({
  selector: 'pos-dialog',
  standalone: true,
  imports: [A11yModule, LucideAngularModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="backdrop" (click)="dismissible() && closed.emit()"></div>
    <section
      class="dialog"
      [class.dialog--wide]="wide()"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="titleId"
      cdkTrapFocus
      cdkTrapFocusAutoCapture
    >
      <header class="dialog__header">
        <h2 [id]="titleId">{{ title() | translate }}</h2>
        @if (dismissible()) {
          <button
            type="button"
            class="icon-btn"
            (click)="closed.emit()"
            [attr.aria-label]="'pos.close' | translate"
          >
            <lucide-icon [img]="XIcon" size="18" aria-hidden="true" />
          </button>
        }
      </header>
      <div class="dialog__body"><ng-content /></div>
      <footer class="dialog__footer">
        <ng-content select="[dialog-actions]" />
      </footer>
    </section>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 50;
        display: grid;
        place-items: center;
        padding: 16px;
      }
      .backdrop {
        position: absolute;
        inset: 0;
        background: rgb(0 0 0 / 0.6);
        backdrop-filter: blur(2px);
      }
      .dialog {
        position: relative;
        width: min(480px, 100%);
        max-height: calc(100vh - 32px);
        overflow: auto;
        background: var(--pos-surface);
        border: 1px solid var(--pos-border);
        border-radius: var(--pos-radius-lg);
        box-shadow: var(--pos-shadow-lg);
        display: flex;
        flex-direction: column;
        animation: pop 0.14s ease-out;
      }
      .dialog--wide {
        width: min(880px, 100%);
      }
      .dialog__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 20px 8px;
      }
      .dialog__header h2 {
        margin: 0;
        font-size: 1.15rem;
      }
      .dialog__body {
        padding: 8px 20px 12px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .dialog__footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding: 12px 20px 18px;
        flex-wrap: wrap;
      }
      .dialog__footer:empty {
        display: none;
      }
      @keyframes pop {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .dialog {
          animation: none;
        }
      }
    `,
  ],
})
export class DialogComponent {
  readonly title = input.required<string>();
  readonly wide = input(false);
  readonly dismissible = input(true);
  readonly closed = output<void>();
  protected readonly titleId = `pos-dialog-${++nextId}`;
  protected readonly XIcon = X;

  /**
   * Escape closes the dialog wherever focus happens to be. Bound to the section, it stopped working
   * the moment the focused element was removed (a confirmed inline form) and focus fell to the body.
   */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.dismissible()) this.closed.emit();
  }
}
