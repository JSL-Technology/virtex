import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import {
  TERMINAL_ID_PATTERN,
  TerminalConfigService,
} from '../../../core/terminal-config.service';
import { ToastService } from '../../../core/toast.service';
import { TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/**
 * This device's till settings: which terminal it is, whether tickets print on their own.
 *
 * - An identifier it cannot take says why, under the field (POS-01): «CAJA 1 ñ» used to switch the
 *   button off and leave the hint unchanged.
 * - It says these settings belong to this device (POS-04): they are kept in this browser, and two
 *   tills in one shop each have their own.
 * - The shortcuts have their own dialog (POS-02), linked from here.
 */
@Component({
  selector: 'pos-settings-dialog',
  standalone: true,
  imports: [TranslateModule, DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.settings.title'" (closed)="closed.emit()">
      <form class="form" (submit)="$event.preventDefault(); save()">
        <p class="note" role="note">{{ 'pos.settings.device_note' | translate }}</p>
        <label class="field" for="pos-terminal-id">
          {{ 'pos.settings.terminal' | translate }}
          <input
            id="pos-terminal-id"
            type="text"
            maxlength="40"
            autocomplete="off"
            [value]="terminal()"
            (input)="terminal.set($any($event.target).value); touched.set(true)"
            (blur)="touched.set(true)"
            [attr.aria-invalid]="showError() ? 'true' : null"
            [attr.aria-describedby]="showError() ? 'pos-terminal-error' : 'pos-terminal-hint'"
          />
          @if (showError()) {
            <span class="field-error" id="pos-terminal-error" role="alert">{{ 'pos.settings.terminal_invalid' | translate }}</span>
          } @else {
            <span class="field-hint" id="pos-terminal-hint">{{ 'pos.settings.terminal_hint' | translate }}</span>
          }
        </label>
        @if (till.shiftReady() && terminal().trim() !== config.terminalId()) {
          <p class="alert alert-warning">
            {{ 'pos.settings.terminal_open_shift' | translate }}
          </p>
        }
        <label class="check">
          <input
            type="checkbox"
            [checked]="autoPrint()"
            (change)="autoPrint.set($any($event.target).checked)"
          />
          <span>{{ 'pos.settings.auto_print' | translate }}</span>
        </label>
      </form>
      <button type="button" class="link" (click)="showShortcuts.emit()">{{ 'pos.settings.see_shortcuts' | translate }}</button>
      <ng-container dialog-actions>
        <button type="button" class="btn" (click)="closed.emit()">
          {{ 'pos.cancel' | translate }}
        </button>
        <button
          type="button"
          class="btn btn-primary"
          (click)="save()"
        >
          {{ 'pos.settings.save' | translate }}
        </button>
      </ng-container>
    </pos-dialog>
  `,
  styles: [
    `
      .form {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .check {
        display: flex;
        gap: 10px;
        align-items: center;
        min-height: 44px;
      }
      .check input {
        width: 20px;
        height: 20px;
        accent-color: var(--pos-primary);
      }
      .note {
        margin: 0;
        font-size: 0.9rem;
        color: var(--pos-muted);
      }
      .field-error {
        font-size: 0.85rem;
        color: var(--pos-danger, #b42318);
      }
      .link {
        align-self: flex-start;
        margin-top: 12px;
        padding: 0;
        border: none;
        background: none;
        color: var(--pos-primary);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
        min-height: 44px;
      }
      .alert {
        margin: 0;
      }
    `,
  ],
})
export class SettingsDialogComponent {
  protected readonly config = inject(TerminalConfigService);
  protected readonly till = inject(TillStore);
  private readonly toast = inject(ToastService);
  readonly closed = output<void>();
  readonly showShortcuts = output<void>();

  protected readonly terminal = signal(this.config.terminalId());
  protected readonly autoPrint = signal(this.config.autoPrint());
  protected readonly touched = signal(false);
  protected readonly valid = computed(() => TERMINAL_ID_PATTERN.test(this.terminal().trim()));
  /** Said once the cashier has typed or left the field, not on opening. */
  protected readonly showError = computed(() => this.touched() && !this.valid());

  protected save(): void {
    this.touched.set(true);
    if (!this.valid()) return;
    const id = this.terminal().trim();
    if (id !== this.config.terminalId()) this.till.switchTerminal(id);
    this.config.setAutoPrint(this.autoPrint());
    this.toast.success('pos.settings.saved');
    this.closed.emit();
  }
}
