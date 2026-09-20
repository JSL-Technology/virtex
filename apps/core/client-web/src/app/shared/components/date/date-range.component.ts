import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { VxDateFieldComponent } from './date-field.component';

let nextId = 0;

/**
 * A from/to pair that cannot be inverted without saying so.
 *
 * ## What this replaces
 *
 * Fifteen pages pair two `<input type="date">` — the four financial statements, both
 * profitability reports, the general ledger, the statement import, the purchase-order form and
 * seven more. Between them, **zero** bound one end with the other and **zero** checked that the
 * start came before the end. An inverted range produced an empty report and no message, which
 * reads as "there is no data for this period".
 *
 * Each end is bounded by the other through the native control's own `min`/`max`, so in most
 * browsers the invalid dates are not offered at all; the message is the backstop for the ones
 * that let it through and for a value typed by keyboard.
 */
@Component({
  selector: 'vx-date-range',
  standalone: true,
  imports: [TranslateModule, VxDateFieldComponent],
  template: `
    <div class="vx-date-range__field">
      <label [attr.for]="fromId">{{ fromLabelKey() | translate }}</label>
      <vx-date-field
        [inputId]="fromId"
        [value]="from()"
        [max]="to()"
        [ariaDescribedBy]="inverted() ? messageId : null"
        (valueChange)="from.set($event)"
      />
    </div>

    <div class="vx-date-range__field">
      <label [attr.for]="toId">{{ toLabelKey() | translate }}</label>
      <vx-date-field
        [inputId]="toId"
        [value]="to()"
        [min]="from()"
        [ariaDescribedBy]="inverted() ? messageId : null"
        (valueChange)="to.set($event)"
      />
    </div>

    @if (inverted()) {
      <p class="vx-date-range__message" [id]="messageId" role="alert">
        {{ 'common.date_range_inverted' | translate }}
      </p>
    }
  `,
  styleUrls: ['./date-range.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-date-range' },
})
export class VxDateRangeComponent {
  readonly from = model<string | null>(null);
  readonly to = model<string | null>(null);
  readonly fromLabelKey = input('common.from');
  readonly toLabelKey = input('common.to');

  private readonly uid = `vx-date-range-${nextId++}`;
  protected readonly fromId = `${this.uid}-from`;
  protected readonly toId = `${this.uid}-to`;
  protected readonly messageId = `${this.uid}-message`;

  /** Valid is the DEFAULT: a half-filled range is not yet wrong, it is not yet complete. */
  readonly inverted = computed(() => {
    const from = this.from();
    const to = this.to();
    return !!from && !!to && from > to;
  });
}
