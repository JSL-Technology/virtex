import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Something is happening and it is not finished.
 *
 * ## What this replaces
 *
 * Sixteen hand-written `@keyframes` for "rotate 360 degrees" —
 * `settings/_settings-shared.scss:461`, `settings/billing/billing.page.scss:611`,
 * `data-imports/data-imports.page.scss:164`, `layout/main/main.layout.scss:1380` and twelve more —
 * on top of `vx-spin`, which has been in `assets/styles/base/_elements.scss:213` the whole time.
 *
 * ## Why it carries a label and not just a circle
 *
 * A spinning circle is invisible to a screen reader: it is a `<div>` with a background animation.
 * `role="status"` plus a real sentence is what turns "the page looks frozen" into "loading the
 * customer list". The label is visually hidden unless `withLabel` asks for it, so the appearance
 * is unchanged and the announcement is not optional.
 */
@Component({
  selector: 'vx-spinner',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <span class="vx-spinner__wheel" aria-hidden="true"></span>
    <span [class.vx-spinner__label]="!withLabel()" [class.vx-spinner__caption]="withLabel()">
      {{ labelKey() | translate }}
    </span>
  `,
  styleUrls: ['./spinner.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'vx-spinner',
    role: 'status',
    'aria-live': 'polite',
    '[attr.aria-busy]': 'true',
    '[class]': "'vx-spinner vx-spinner--' + size()",
  },
})
export class VxSpinnerComponent {
  readonly size = input<'sm' | 'md' | 'lg'>('md');
  /** What is loading, as a catalogue key. Generic by default; say more where you can. */
  readonly labelKey = input('common.loading');
  /** Print the label beside the wheel instead of only announcing it. */
  readonly withLabel = input(false);
}
