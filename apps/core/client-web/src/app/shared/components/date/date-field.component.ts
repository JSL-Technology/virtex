import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';

let nextId = 0;

/**
 * A calendar date, as `YYYY-MM-DD`.
 *
 * ## Why the native control and not a hand-built calendar
 *
 * Because the native one is better than anything worth building here. It is keyboard-operable, it
 * speaks every locale the device has, it opens the platform's own picker on a phone, and it is
 * already tested by the browser vendors. A bespoke calendar is several hundred lines that start
 * out worse at all four and stay worse.
 *
 * ## What this actually fixes
 *
 * The 41 `<input type="date">` in the product had **no `[min]` and no `[max]` between them**, so
 * the fifteen from/to pairs accepted an inverted range and answered with an empty report and no
 * message (`features/reports/financial-statements/*`, `features/accounting/general-ledger`, …).
 * This field can be bounded, and `vx-date-range` bounds each end with the other.
 *
 * It also carries its own `aria-invalid` from the bound control, and normalises the value: the
 * empty string a cleared date input produces becomes `null`, so "no date" is one value rather
 * than two.
 *
 * ## Known limitation, stated rather than hidden
 *
 * The native control renders the date in the BROWSER's locale, not the tenant's, while `vxDate`
 * renders it in the tenant's — so a date can be typed in one order and read back in another on
 * the same screen. Fixing that means replacing the platform picker, which costs more than it
 * buys. Where the distinction matters, show the value with `| vxDate` beside the field.
 */
@Component({
  selector: 'vx-date-field',
  standalone: true,
  template: `
    <input
      class="vx-date-field__input"
      type="date"
      [id]="inputId() || fallbackId"
      [value]="shown() ?? ''"
      [disabled]="isDisabled()"
      [attr.min]="min()"
      [attr.max]="max()"
      [attr.required]="required() ? 'true' : null"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="ariaLabelledBy()"
      [attr.aria-describedby]="ariaDescribedBy()"
      [attr.aria-invalid]="invalid() ? 'true' : null"
      (input)="onInput($event)"
      (blur)="onBlur()"
    />
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

  readonly inputId = input<string>('');
  /** `YYYY-MM-DD`. The other end of a range, usually. */
  readonly min = input<string | null>(null);
  readonly max = input<string | null>(null);
  readonly required = input(false);
  readonly ariaLabel = input<string | null>(null);
  readonly ariaLabelledBy = input<string | null>(null);
  readonly ariaDescribedBy = input<string | null>(null);

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
  protected readonly shown = signal<string | null>(null);
  protected readonly isDisabled = signal(false);

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
      if (!this.ngControl) this.shown.set(toCalendarDate(incoming));
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
    this.shown.set(toCalendarDate(value));
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

  protected onInput(event: Event): void {
    //  Vacío es AUSENCIA, no cadena vacía. Un control que puede valer `''` o `null` para decir lo
    //  mismo obliga a cada llamante a comprobar las dos cosas, y la mitad comprueba solo una.
    const raw = (event.target as HTMLInputElement).value;
    const next = raw || null;
    this.shown.set(next);
    this.onChange(next);
    this.valueChange.emit(next);
  }

  protected onBlur(): void {
    this.onTouched();
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
