import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';

/**
 * The one place a settings section is saved: fixed to the bottom of the section, so «Save» is in
 * view however long the section is (Contabilidad's sat 1,455 px down at 1366×768), and present only
 * while there is something to save.
 *
 * When saving is not possible it says why (`blockedKey`), instead of a grey button that leaves the
 * person searching the form for the field that stops it.
 */
@Component({
  selector: 'vx-settings-save-bar',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (dirty() || saving()) {
      <div class="ssb" role="region" [attr.aria-label]="'settings.shell.save_bar' | translate">
        <p class="ssb__status" aria-live="polite">
          @if (blockedKey(); as blocked) {
            <span class="ssb__blocked">{{ blocked | translate: blockedParams() }}</span>
          } @else {
            <span class="ssb__dot" aria-hidden="true"></span>
            {{ 'settings.shell.unsaved_changes' | translate }}
          }
        </p>
        <div class="ssb__actions">
          <button type="button" class="secondary-button" [disabled]="saving()" (click)="discard.emit()">
            {{ 'settings.shell.discard' | translate }}
          </button>
          <button type="button" class="primary-button" [disabled]="saving() || !!blockedKey()" (click)="save.emit()">
            {{ (saving() ? 'settings.shell.saving' : 'settings.shell.save') | translate }}
          </button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .ssb {
        position: sticky;
        bottom: 0;
        z-index: 2;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: var(--space-3);
        margin-top: var(--space-6);
        padding: var(--space-3) var(--space-4);
        background: var(--surface-raised);
        border: 1px solid var(--border-default);
        border-radius: var(--radius-md);
        box-shadow: 0 -6px 16px rgba(var(--shadow-color-rgb), 0.08);
      }
      .ssb__status { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-sm); color: var(--content-secondary); }
      .ssb__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warning-solid); }
      .ssb__blocked { color: var(--warning-text); font-weight: var(--font-medium); }
      .ssb__actions { display: flex; gap: var(--space-2); margin-left: auto; }
    `,
  ],
})
export class SettingsSaveBarComponent {
  readonly dirty = input(false);
  readonly saving = input(false);
  /** Why saving is not possible right now, as an i18n key; null when it is. */
  readonly blockedKey = input<string | null>(null);
  readonly blockedParams = input<Record<string, unknown>>({});
  readonly save = output<void>();
  readonly discard = output<void>();
}
