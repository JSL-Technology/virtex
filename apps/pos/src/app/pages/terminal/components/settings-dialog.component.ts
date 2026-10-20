import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { TERMINAL_ID_PATTERN, TerminalConfigService } from '../../../core/terminal-config.service';
import { ToastService } from '../../../core/toast.service';
import { TillStore } from '../../../state/till.store';
import { DialogComponent } from './dialog.component';

/** Shortcuts, as listed to the cashier. Kept next to the dialog that documents them. */
export const SHORTCUTS: ReadonlyArray<{ keys: string; labelKey: string }> = [
  { keys: 'F2', labelKey: 'pos.shortcuts.search' },
  { keys: 'F4', labelKey: 'pos.shortcuts.customer' },
  { keys: 'F6', labelKey: 'pos.shortcuts.journal' },
  { keys: 'F7', labelKey: 'pos.shortcuts.shift' },
  { keys: 'F8', labelKey: 'pos.shortcuts.park' },
  { keys: 'F9', labelKey: 'pos.shortcuts.charge' },
  { keys: '+ / −', labelKey: 'pos.shortcuts.quantity' },
  { keys: 'Supr', labelKey: 'pos.shortcuts.remove' },
  { keys: 'Esc', labelKey: 'pos.shortcuts.close' },
];

/** This device's till settings: which terminal it is, whether tickets print on their own. */
@Component({
  selector: 'pos-settings-dialog',
  standalone: true,
  imports: [TranslateModule, DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.settings.title'" (closed)="closed.emit()">
      <form class="form" (submit)="$event.preventDefault(); save()">
        <label class="field">
          {{ 'pos.settings.terminal' | translate }}
          <input type="text" maxlength="40" autocomplete="off" [value]="terminal()" (input)="terminal.set($any($event.target).value)" [attr.aria-invalid]="!valid()" />
          <span class="field-hint">{{ 'pos.settings.terminal_hint' | translate }}</span>
        </label>
        @if (till.shiftReady() && terminal().trim() !== config.terminalId()) {
          <p class="alert alert-warning">{{ 'pos.settings.terminal_open_shift' | translate }}</p>
        }
        <label class="check">
          <input type="checkbox" [checked]="autoPrint()" (change)="autoPrint.set($any($event.target).checked)" />
          <span>{{ 'pos.settings.auto_print' | translate }}</span>
        </label>
      </form>
      <section>
        <h3>{{ 'pos.shortcuts.title' | translate }}</h3>
        <dl class="kv shortcuts">
          @for (s of shortcuts; track s.keys) {
            <div><dt>{{ s.labelKey | translate }}</dt><dd><kbd>{{ s.keys }}</kbd></dd></div>
          }
        </dl>
      </section>
      <ng-container dialog-actions>
        <button type="button" class="btn" (click)="closed.emit()">{{ 'pos.cancel' | translate }}</button>
        <button type="button" class="btn btn-primary" [disabled]="!valid()" (click)="save()">{{ 'pos.settings.save' | translate }}</button>
      </ng-container>
    </pos-dialog>
  `,
  styles: [
    `
      .form { display: flex; flex-direction: column; gap: 14px; }
      .check { display: flex; gap: 10px; align-items: center; min-height: 44px; }
      .check input { width: 20px; height: 20px; accent-color: var(--pos-primary); }
      h3 { margin: 4px 0 8px; font-size: 0.85rem; color: var(--pos-muted); text-transform: uppercase; letter-spacing: 0.04em; }
      .shortcuts { font-size: 0.9rem; }
      .alert { margin: 0; }
    `,
  ],
})
export class SettingsDialogComponent {
  protected readonly config = inject(TerminalConfigService);
  protected readonly till = inject(TillStore);
  private readonly toast = inject(ToastService);
  readonly closed = output<void>();

  protected readonly shortcuts = SHORTCUTS;
  protected readonly terminal = signal(this.config.terminalId());
  protected readonly autoPrint = signal(this.config.autoPrint());

  protected valid(): boolean {
    return TERMINAL_ID_PATTERN.test(this.terminal().trim());
  }

  protected save(): void {
    if (!this.valid()) return;
    const id = this.terminal().trim();
    if (id !== this.config.terminalId()) this.till.switchTerminal(id);
    this.config.setAutoPrint(this.autoPrint());
    this.toast.success('pos.settings.saved');
    this.closed.emit();
  }
}
