import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, CalendarDays } from 'lucide-angular';
import { FormatService, TranslateModule } from '@virteex/shared/ui-i18n';

let nextId = 0;

/**
 * A calendar date, as `YYYY-MM-DD`, typed in the format the reader reads.
 *
 * ## Why it is no longer the bare native control
 *
 * The native `<input type="date">` writes the date in the BROWSER's locale. Everything else on the
 * screen writes it in the company's — or, now, in the format the company or the person chose
 * (`RegionalFormat`). So the audit trail's filter read `mm/dd/yyyy` above a table in `dd/mm/yyyy`
 * (CG-29), a Dominican company's due dates were typed in American order (CG-30), and a person who
 * chose year-first dates could not type one. A date has to be written the same way it is read.
 *
 * So the field is text, in the order and with the separator in force, and the platform's own
 * picker is still one click (or Alt+↓) away: a hidden native control is opened with
 * `showPicker()`, which keeps the keyboard-operable, locale-aware, phone-native calendar the
 * previous version chose the native control for — without letting it decide how the date reads.
 *
 * ## What it still guarantees
 *
 * - `min`/`max` bound the picker and are checked on what is typed, with a message.
 * - The value is `YYYY-MM-DD` or `null`; a half-typed or impossible date («31/02») is `null` and
 *   says why, and is never rolled into the next month.
 * - `aria-invalid` from the bound control, plus its own message for a date it cannot read.
 * - An ISO date is accepted whatever the order: pasting `2026-09-14` cannot be misread.
 */
@Component({
  selector: 'vx-date-field',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule],
  template: `
    <div class="vx-date-field__box">
      <input
        class="vx-date-field__input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        [id]="inputId() || fallbackId"
        [value]="text()"
        [placeholder]="placeholder()"
        [disabled]="isDisabled()"
        [readOnly]="readonly()"
        [attr.required]="required() ? 'true' : null"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-labelledby]="ariaLabelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-invalid]="invalid() || problem() ? 'true' : null"
        (input)="onType($event)"
        (blur)="onBlur()"
        (keydown.alt.arrowdown)="$event.preventDefault(); openPicker()"
      />
      <button
        type="button"
        class="vx-date-field__picker"
        tabindex="-1"
        [disabled]="isDisabled() || readonly()"
        [attr.aria-label]="'shared.date_field.open_calendar' | translate"
        [title]="'shared.date_field.open_calendar' | translate"
        (click)="openPicker()"
      >
        <lucide-icon [img]="CalendarIcon" size="16" aria-hidden="true"></lucide-icon>
      </button>
      <!-- The platform's calendar, opened by the button; never focused, never read aloud. -->
      <input
        #native
        class="vx-date-field__native"
        type="date"
        tabindex="-1"
        aria-hidden="true"
        [value]="shown() ?? ''"
        [attr.min]="min()"
        [attr.max]="max()"
        (change)="onPicked($event)"
      />
    </div>
    @if (problem(); as message) {
      <small class="vx-date-field__problem" [id]="problemId" role="alert">{{ message.key | translate: message.params }}</small>
    }
  `,
  styleUrls: ['./date-field.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'vx-date-field' },
})
export class VxDateFieldComponent implements ControlValueAccessor {
  /**
   * Self-injected and wired by hand, as in `vx-select`: declaring `NG_VALUE_ACCESSOR` makes the
   * control and its accessor mutually dependent and Angular refuses the cycle. It also lets the
   * field read its own validity, so `aria-invalid` lands on the input rather than the wrapper.
   */
  private readonly ngControl = inject(NgControl, { optional: true, self: true });
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);

  protected readonly CalendarIcon = CalendarDays;
  private readonly nativeInput = viewChild<ElementRef<HTMLInputElement>>('native');

  readonly inputId = input<string>('');
  /** `YYYY-MM-DD`. The other end of a range, usually. */
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly required = input(false);
  /** Shown and focusable, not editable: a field of a finished step, say. */
  readonly readonly = input(false);
  readonly ariaLabel = input<string | null>(null);
  readonly ariaLabelledBy = input<string | null>(null);
  readonly ariaDescribedBy = input<string | null>(null);
  /**
   * Say so when the date falls outside `min`/`max`. Off where a caller says it better about the
   * pair — `vx-date-range` names the inverted range once, for both ends.
   */
  readonly boundsMessage = input(true);

  /**
   * The value, for a caller that is not using a form control.
   *
   * `vx-date-range` is exactly that caller: it owns both ends as signals, so binding each one
   * through a `FormControl` would be a form built to hold two strings. Ignored when the field IS
   * bound to a control — there the control is the single source of truth and a second one would
   * be a race.
   */
  readonly value = input<string | null>(null);
  readonly valueChange = output<string | null>();

  protected readonly fallbackId = `vx-date-${nextId++}`;
  protected readonly problemId = `${this.fallbackId}-problem`;
  /** The value, `YYYY-MM-DD` or null. */
  protected readonly shown = signal<string | null>(null);
  /** What the field shows: the value in the format in force, or what is being typed. */
  protected readonly text = signal('');
  /** What was typed and could not be read, kept on screen so it can be corrected. */
  private readonly unreadable = signal(false);
  protected readonly isDisabled = signal(false);

  protected readonly placeholder = computed(() => {
    this.format.datePattern();
    return this.format.datePlaceholder({
      day: this.translate.instant('shared.date_field.day_letter'),
      month: this.translate.instant('shared.date_field.month_letter'),
      year: this.translate.instant('shared.date_field.year_letter'),
    });
  });

  /** Why the date cannot stand, in words: unreadable, or outside the bounds. */
  protected readonly problem = computed<{ key: string; params: Record<string, unknown> } | null>(() => {
    if (this.unreadable()) return { key: 'shared.date_field.unreadable', params: { pattern: this.placeholder() } };
    if (!this.boundsMessage()) return null;
    const value = this.shown();
    const min = this.min();
    const max = this.max();
    if (value && min && value < min) return { key: 'shared.date_field.before_min', params: { date: this.format.date(min) } };
    if (value && max && value > max) return { key: 'shared.date_field.after_max', params: { date: this.format.date(max) } };
    return null;
  });

  protected readonly describedBy = computed(() =>
    [this.ariaDescribedBy(), this.problem() ? this.problemId : null].filter(Boolean).join(' ') || null,
  );

  private readonly revision = signal(0);
  protected readonly invalid = computed(() => {
    this.revision();
    const control = this.ngControl?.control;
    return !!control && control.invalid && control.touched;
  });

  constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;

    //  Sin control, el valor entra por la entrada. Con control, manda `writeValue` y esta lectura
    //  no hace nada: dos fuentes para el mismo dato es una carrera esperando a ocurrir.
    effect(() => {
      const incoming = this.value();
      if (!this.ngControl) untracked(() => this.show(toCalendarDate(incoming)));
    });

    // The format changed (the person chose another order): rewrite what is shown, not the value.
    effect(() => {
      this.format.datePattern();
      untracked(() => {
        if (!this.unreadable()) this.text.set(this.format.dateForInput(this.shown()));
      });
    });

    effect((onCleanup) => {
      this.revision();
      const control = this.ngControl?.control;
      if (!control) return;
      const subscription = control.events.subscribe(() =>
        this.revision.update((value) => value + 1),
      );
      onCleanup(() => subscription.unsubscribe());
    });
  }

  private onChange: (value: string | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string | null): void {
    //  Se acepta un `Date` o un ISO completo porque los registros llegan de las dos formas, y se
    //  guarda siempre el día suelto: una fecha contable no tiene hora ni zona, y darle una es lo
    //  que convierte el 31 de enero en el 30 para todo el que esté al oeste de Greenwich.
    this.show(toCalendarDate(value));
  }

  registerOnChange(fn: (value: string | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.isDisabled.set(disabled);
  }

  /** Opens the platform's calendar. Older browsers without `showPicker` get the control's own click. */
  openPicker(): void {
    const native = this.nativeInput()?.nativeElement;
    if (!native || this.isDisabled() || this.readonly()) return;
    try {
      if (typeof native.showPicker === 'function') {
        native.showPicker();
        return;
      }
    } catch {
      // `showPicker` throws outside a user gesture or in a cross-origin frame; fall through.
    }
    native.click();
  }

  protected onType(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.text.set(raw);
    //  Vacío es AUSENCIA, no cadena vacía. Un control que puede valer `''` o `null` para decir lo
    //  mismo obliga a cada llamante a comprobar las dos cosas, y la mitad comprueba solo una.
    if (raw.trim() === '') {
      this.unreadable.set(false);
      this.commit(null);
      return;
    }
    // While typing, only a complete, real date is committed; the rest waits for the blur.
    const parsed = this.format.parseDate(raw);
    if (parsed) {
      this.unreadable.set(false);
      this.commit(parsed);
    }
  }

  protected onPicked(event: Event): void {
    const value = (event.target as HTMLInputElement).value || null;
    this.unreadable.set(false);
    this.text.set(this.format.dateForInput(value));
    this.commit(value);
    this.onTouched();
  }

  protected onBlur(): void {
    const raw = this.text();
    if (raw.trim() !== '') {
      const parsed = this.format.parseDate(raw);
      if (parsed) {
        // Written back in the format in force: «1/9/26» reads «01/09/2026» once it is understood.
        this.unreadable.set(false);
        this.text.set(this.format.dateForInput(parsed));
        this.commit(parsed);
      } else {
        // Kept on screen to be corrected, and the value is no date at all rather than a stale one —
        // said to the control even when it already held nothing, so `''` becomes `null`.
        this.unreadable.set(true);
        this.shown.set(null);
        this.onChange(null);
        this.valueChange.emit(null);
      }
    }
    this.onTouched();
  }

  private show(value: string | null): void {
    this.shown.set(value);
    this.unreadable.set(false);
    this.text.set(this.format.dateForInput(value));
  }

  private commit(value: string | null): void {
    if (value === this.shown()) return;
    this.shown.set(value);
    this.onChange(value);
    this.valueChange.emit(value);
  }
}

/** `Date`, ISO timestamp or `YYYY-MM-DD` → `YYYY-MM-DD`, in UTC. Null for anything unusable. */
export function toCalendarDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match ? match[1] : null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}
