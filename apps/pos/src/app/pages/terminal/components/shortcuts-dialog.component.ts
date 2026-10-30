import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { DialogComponent } from './dialog.component';

/** Shortcuts, as listed to the cashier. The keys the terminal listens for (`TerminalComponent.onKey`). */
export const SHORTCUTS: ReadonlyArray<{ keys: string; labelKey: string }> = [
  { keys: 'F1', labelKey: 'pos.shortcuts.help' },
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

/**
 * The keyboard shortcuts, on their own (POS-02).
 *
 * They took more than half of the settings dialog, and they are not a setting: a cashier looking
 * for them does not think «settings», and someone changing the terminal does not need them. Opened
 * with F1 or from the toolbar, and linked from the settings dialog.
 */
@Component({
  selector: 'pos-shortcuts-dialog',
  standalone: true,
  imports: [TranslateModule, DialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <pos-dialog [title]="'pos.shortcuts.title'" (closed)="closed.emit()">
      <dl class="kv shortcuts">
        @for (s of shortcuts; track s.keys) {
          <div>
            <dt>{{ s.labelKey | translate }}</dt>
            <dd><kbd>{{ s.keys }}</kbd></dd>
          </div>
        }
      </dl>
      <ng-container dialog-actions>
        <button type="button" class="btn btn-primary" (click)="closed.emit()">{{ 'pos.close' | translate }}</button>
      </ng-container>
    </pos-dialog>
  `,
  styles: [`.shortcuts { font-size: 0.95rem; }`],
})
export class ShortcutsDialogComponent {
  readonly closed = output<void>();
  protected readonly shortcuts = SHORTCUTS;
}
