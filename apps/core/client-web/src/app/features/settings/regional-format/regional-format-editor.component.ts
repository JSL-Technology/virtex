import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { TranslateModule, LocaleStore, localeDatePattern, localeNumberSymbols } from '@virteex/shared/ui-i18n';
import {
  DATE_ORDERS,
  DATE_SEPARATORS,
  DateOrder,
  NUMBER_FORMATS,
  NUMBER_FORMAT_SYMBOLS,
  RegionalFormat,
  RegionalFormatField,
  TIME_FORMATS,
  TimeFormat,
  WEEK_STARTS,
  mergeRegionalFormats,
} from '@virteex/shared/types';

/** The day every example is written with: the 14th, so day and month cannot be mistaken. */
const SAMPLE_DAY = { D: '14', M: '09', Y: '2026' };
const SAMPLE_INSTANT = new Date(Date.UTC(2026, 8, 14, 18, 30));
const SAMPLE_NUMBER = 1234567.89;

interface Choice<T> {
  value: T | '';
  label: string;
}

/**
 * The five choices of a regional format — date order, date separator, number format, clock and
 * first day of the week — each written as an example rather than as a code: «14/09/2026», not
 * «DMY»; «1.234.567,89», not «dot_comma».
 *
 * «Automático» is always the first option and says what it currently means («Automático ·
 * 14/09/2026»): for a person, what the company decided; for the company, what its country's
 * locale writes. Choosing it removes the field, so it keeps following that level if it changes.
 *
 * The preview below writes a date, a timestamp, an amount and a number with what is selected,
 * before anything is saved — the point of a format is how it looks, and a list of codes cannot
 * show that.
 */
@Component({
  selector: 'app-regional-format-editor',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div class="rf">
      <div class="rf__grid">
        <label class="rf__field">
          <span class="rf__label">{{ 'settings.regional_format.date_order' | translate }}</span>
          <select [disabled]="disabled()" [value]="value().dateOrder ?? ''" (change)="set('dateOrder', $any($event.target).value)">
            @for (choice of dateOrderChoices(); track choice.value) {
              <option [value]="choice.value">{{ choice.label }}</option>
            }
          </select>
        </label>

        <label class="rf__field">
          <span class="rf__label">{{ 'settings.regional_format.date_separator' | translate }}</span>
          <select [disabled]="disabled()" [value]="value().dateSeparator ?? ''" (change)="set('dateSeparator', $any($event.target).value)">
            @for (choice of separatorChoices(); track choice.value) {
              <option [value]="choice.value">{{ choice.label }}</option>
            }
          </select>
        </label>

        <label class="rf__field">
          <span class="rf__label">{{ 'settings.regional_format.number_format' | translate }}</span>
          <select [disabled]="disabled()" [value]="value().numberFormat ?? ''" (change)="set('numberFormat', $any($event.target).value)">
            @for (choice of numberChoices(); track choice.value) {
              <option [value]="choice.value">{{ choice.label }}</option>
            }
          </select>
          <small class="rf__hint">{{ 'settings.regional_format.number_hint' | translate }}</small>
        </label>

        <label class="rf__field">
          <span class="rf__label">{{ 'settings.regional_format.time_format' | translate }}</span>
          <select [disabled]="disabled()" [value]="value().timeFormat ?? ''" (change)="set('timeFormat', $any($event.target).value)">
            @for (choice of timeChoices(); track choice.value) {
              <option [value]="choice.value">{{ choice.label }}</option>
            }
          </select>
        </label>

        <label class="rf__field">
          <span class="rf__label">{{ 'settings.regional_format.first_day_of_week' | translate }}</span>
          <select [disabled]="disabled()" [value]="value().firstDayOfWeek ?? ''" (change)="set('firstDayOfWeek', $any($event.target).value)">
            @for (choice of weekChoices(); track choice.value) {
              <option [value]="choice.value">{{ choice.label }}</option>
            }
          </select>
        </label>
      </div>

      <section class="rf__preview" [attr.aria-label]="'settings.regional_format.preview' | translate">
        <h3 class="rf__preview-title">{{ 'settings.regional_format.preview' | translate }}</h3>
        <dl>
          <div><dt>{{ 'settings.regional_format.preview_date' | translate }}</dt><dd>{{ preview().date }}</dd></div>
          <div><dt>{{ 'settings.regional_format.preview_date_time' | translate }}</dt><dd>{{ preview().dateTime }}</dd></div>
          <div><dt>{{ 'settings.regional_format.preview_amount' | translate }}</dt><dd>{{ preview().money }}</dd></div>
          <div><dt>{{ 'settings.regional_format.preview_number' | translate }}</dt><dd>{{ preview().number }}</dd></div>
          <div><dt>{{ 'settings.regional_format.preview_week' | translate }}</dt><dd>{{ preview().week }}</dd></div>
        </dl>
        <p class="rf__hint">{{ 'settings.regional_format.preview_note' | translate }}</p>
      </section>
    </div>
  `,
  styles: [
    `
      .rf { display: flex; flex-direction: column; gap: var(--space-5); }
      .rf__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--space-4); }
      .rf__field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
      .rf__label { font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--content-secondary); }
      .rf__field select {
        height: 2.375rem; padding: 0 var(--space-3); border: 1px solid var(--border-color); border-radius: var(--radius-md);
        background: var(--bg-card); color: var(--content-primary); font: inherit; font-size: var(--text-sm);
      }
      .rf__field select:focus-visible { outline: 2px solid var(--accent-solid); outline-offset: 2px; }
      .rf__field select:disabled { opacity: 0.6; cursor: not-allowed; }
      .rf__hint { margin: 0; font-size: var(--text-xs); color: var(--content-tertiary); }
      .rf__preview { padding: var(--space-4); border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--surface-sunken); }
      .rf__preview-title { margin: 0 0 var(--space-3); font-size: var(--text-sm); font-weight: var(--font-semibold); color: var(--content-primary); }
      .rf__preview dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--space-3); margin: 0 0 var(--space-3); }
      .rf__preview dt { font-size: var(--text-xs); color: var(--content-tertiary); }
      .rf__preview dd { margin: 0; font-size: var(--text-md); font-variant-numeric: tabular-nums; color: var(--content-primary); }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegionalFormatEditorComponent {
  private readonly store = inject(LocaleStore);
  private readonly translate = inject(TranslateService);

  /** This level's choices. Absent fields are «automatic». */
  readonly value = input<RegionalFormat>({});
  /** What «automatic» resolves to at this level: for a person, the company's choices. */
  readonly inherited = input<RegionalFormat>({});
  readonly disabled = input(false);
  readonly valueChange = output<RegionalFormat>();

  private readonly locale = this.store.locale;
  /** What this level would write with nothing chosen: the level above, then the locale. */
  private readonly fallback = computed(() => this.resolve(this.inherited()));
  /** What this level writes with what is selected now. */
  private readonly effective = computed(() => this.resolve(mergeRegionalFormats(this.value(), this.inherited())));

  /** «Automático · 14/09/2026». The language is read so the label follows a language change. */
  private automatic(example: string): string {
    this.store.language();
    return this.translate.instant('settings.regional_format.automatic', { example });
  }

  readonly dateOrderChoices = computed<Choice<DateOrder>[]>(() => {
    const fallback = this.fallback();
    return [
      { value: '', label: this.automatic(this.sampleDate(fallback.order, fallback.separator)) },
      ...DATE_ORDERS.map((order) => ({ value: order, label: this.sampleDate(order, this.effective().separator) })),
    ];
  });

  readonly separatorChoices = computed<Choice<string>[]>(() => {
    const fallback = this.fallback();
    return [
      { value: '', label: this.automatic(this.sampleDate(fallback.order, fallback.separator)) },
      ...DATE_SEPARATORS.map((separator) => ({ value: separator, label: this.sampleDate(this.effective().order, separator) })),
    ];
  });

  readonly numberChoices = computed<Choice<string>[]>(() => [
    { value: '', label: this.automatic(this.sampleNumber(this.fallback().symbols)) },
    ...NUMBER_FORMATS.map((format) => ({ value: format, label: this.sampleNumber(NUMBER_FORMAT_SYMBOLS[format]) })),
  ]);

  readonly timeChoices = computed<Choice<TimeFormat>[]>(() => [
    { value: '', label: this.automatic(this.sampleTime(this.fallback().clock)) },
    ...TIME_FORMATS.map((clock) => ({ value: clock, label: this.sampleTime(clock) })),
  ]);

  readonly weekChoices = computed<Choice<number>[]>(() => [
    { value: '', label: this.automatic(this.weekday(this.fallback().weekStart)) },
    ...WEEK_STARTS.map((day) => ({ value: day, label: this.weekday(day) })),
  ]);

  /** A date, a timestamp, an amount, a number and a week start, as selected. */
  readonly preview = computed(() => {
    const effective = this.effective();
    const date = this.sampleDate(effective.order, effective.separator);
    return {
      date,
      dateTime: `${date} ${this.sampleTime(effective.clock)}`,
      money: this.sampleMoney(effective.symbols, effective.customSymbols),
      number: this.sampleNumber(effective.symbols),
      week: this.weekday(effective.weekStart),
    };
  });

  set(field: RegionalFormatField, raw: string): void {
    const next: Record<string, unknown> = { ...this.value() };
    if (raw === '') delete next[field];
    else next[field] = field === 'firstDayOfWeek' ? Number(raw) : raw;
    this.valueChange.emit(next as RegionalFormat);
  }

  /** A level resolved down to what the locale says for whatever it leaves automatic. */
  private resolve(format: RegionalFormat) {
    const locale = this.locale();
    const pattern = localeDatePattern(locale);
    return {
      order: format.dateOrder ?? pattern.order,
      separator: format.dateSeparator ?? pattern.separator,
      symbols: format.numberFormat ? NUMBER_FORMAT_SYMBOLS[format.numberFormat] : localeNumberSymbols(locale),
      customSymbols: !!format.numberFormat,
      clock: (format.timeFormat ?? this.localeClock(locale)) as TimeFormat,
      weekStart: format.firstDayOfWeek ?? this.store.tenantContext()?.firstDayOfWeek ?? 0,
    };
  }

  private sampleDate(order: DateOrder, separator: string): string {
    return order
      .split('')
      .map((part) => SAMPLE_DAY[part as 'D' | 'M' | 'Y'])
      .join(separator);
  }

  private sampleNumber(symbols: { group: string; decimal: string }): string {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 })
      .formatToParts(SAMPLE_NUMBER)
      .map((part) => (part.type === 'group' ? symbols.group : part.type === 'decimal' ? symbols.decimal : part.value))
      .join('');
  }

  /** An amount in the company's currency, laid out by the locale, with the marks selected. */
  private sampleMoney(symbols: { group: string; decimal: string }, custom: boolean): string {
    const formatter = new Intl.NumberFormat(this.locale(), { style: 'currency', currency: this.store.currency() });
    if (!custom) return formatter.format(SAMPLE_NUMBER);
    return formatter
      .formatToParts(SAMPLE_NUMBER)
      .map((part) => (part.type === 'group' ? symbols.group : part.type === 'decimal' ? symbols.decimal : part.value))
      .join('');
  }

  private sampleTime(clock: TimeFormat): string {
    return new Intl.DateTimeFormat(this.locale(), { hour: '2-digit', minute: '2-digit', hourCycle: clock, timeZone: 'UTC' }).format(SAMPLE_INSTANT);
  }

  private weekday(day: number): string {
    // 2026-09-13 is a Sunday; adding the index gives that weekday.
    const date = new Date(Date.UTC(2026, 8, 13 + day));
    const name = new Intl.DateTimeFormat(this.locale(), { weekday: 'long', timeZone: 'UTC' }).format(date);
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  private localeClock(locale: string): TimeFormat {
    const cycle = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    return cycle === 'h11' || cycle === 'h12' ? 'h12' : 'h23';
  }
}
