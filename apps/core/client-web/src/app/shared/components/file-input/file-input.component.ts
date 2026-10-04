import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * A file picker in the reader's language.
 *
 * A bare `<input type="file">` is drawn by the browser in the BROWSER's language: «Choose File ·
 * No file chosen» on a Spanish screen (QA M-17). The native input stays — it is the only thing
 * that can open the system picker — visually hidden behind a label the app writes. `changed`
 * re-emits the native event, so a page's existing `onFileSelected($event)` keeps working.
 */
@Component({
  selector: 'vx-file-input',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="vx-file" [class.vx-file--disabled]="disabled()">
      <input
        class="vx-file__native"
        type="file"
        [attr.id]="inputId() || null"
        [attr.accept]="accept() || null"
        [disabled]="disabled()"
        (change)="onChange($event)"
      />
      <span class="vx-file__button">{{ 'common.choose_file' | translate }}</span>
      <span class="vx-file__name">{{ fileName() ?? ('common.no_file_chosen' | translate) }}</span>
    </label>
  `,
  styles: [`
    .vx-file { display: inline-flex; align-items: center; gap: var(--space-3); cursor: pointer; max-width: 100%; }
    .vx-file--disabled { cursor: not-allowed; opacity: .6; }
    .vx-file__native { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .vx-file__button { border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: var(--space-1) var(--space-3); background: var(--bg-card); color: var(--text-primary); font-size: var(--text-sm); white-space: nowrap; }
    .vx-file:focus-within .vx-file__button { outline: 2px solid var(--accent-solid); outline-offset: 2px; }
    .vx-file__name { font-size: var(--text-sm); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
})
export class VxFileInputComponent {
  readonly accept = input<string>('');
  readonly inputId = input<string>('');
  readonly disabled = input(false);
  readonly changed = output<Event>();
  readonly fileName = signal<string | null>(null);

  onChange(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.fileName.set(file?.name ?? null);
    this.changed.emit(event);
  }
}
