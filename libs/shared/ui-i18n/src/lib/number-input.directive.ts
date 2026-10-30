import { Directive, ElementRef, Renderer2, effect, forwardRef, inject, untracked } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { AbstractControl, ControlValueAccessor, NG_VALIDATORS, NG_VALUE_ACCESSOR, ValidationErrors, Validator } from '@angular/forms';
import { FormatService } from './format.service';

/**
 * A number field written with the decimal mark the reader reads.
 *
 * ## Why
 *
 * `<input type="number">` shows and accepts the decimal mark of the BROWSER, whatever the company
 * or the person chose — so with `1.234,56` everywhere on the screen, the price field still wanted
 * `1234.56`, and a reader who typed a comma got an empty field and a «required» error. A number has
 * to be typed the way it is read (`RegionalFormat`).
 *
 * ## How
 *
 * Every `type="number"` bound to a form (`formControlName`, `formControl`, `ngModel`) is turned into
 * a text field with a decimal keypad, and this accessor stands between it and the control: the
 * control keeps holding a `number` (or `null`), so validators, arithmetic and requests are
 * untouched — `Validators.min(0)` still compares numbers. What is typed is read with
 * `FormatService.parseNumber`, which refuses rather than guesses; a value it cannot read is
 * `null` with a `localizedNumber` error that says which decimal mark is expected. On blur, a
 * readable value is rewritten canonically, and when the format changes the field follows.
 *
 * Arrow keys keep stepping by `step`, as the native control did. A field that must stay native
 * (a spinner wanted on purpose) opts out with `vxNativeNumber`; the percent field
 * (`appPercent`) has its own accessor and reads the same way.
 */
@Directive({
  selector:
    'input[type=number][formControlName]:not([appPercent]):not([vxNativeNumber]),' +
    'input[type=number][formControl]:not([appPercent]):not([vxNativeNumber]),' +
    'input[type=number][ngModel]:not([appPercent]):not([vxNativeNumber])',
  standalone: true,
  host: {
    '(input)': 'onInput($any($event.target).value)',
    '(blur)': 'onBlur()',
    '(keydown.arrowup)': 'step($event, 1)',
    '(keydown.arrowdown)': 'step($event, -1)',
  },
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => VxNumberInputDirective), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => VxNumberInputDirective), multi: true },
  ],
})
export class VxNumberInputDirective implements ControlValueAccessor, Validator {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly format = inject(FormatService);
  private readonly document = inject(DOCUMENT);

  /** The control's value, as last written or read. */
  private model: number | null = null;
  /** What is typed cannot be read as a number. */
  private unreadable = false;
  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private onValidatorChange: () => void = () => undefined;

  constructor() {
    const input = this.element.nativeElement;
    // Text, so the browser neither rewrites nor drops a comma; a decimal keypad on a phone.
    this.renderer.setAttribute(input, 'type', 'text');
    if (!input.hasAttribute('inputmode')) this.renderer.setAttribute(input, 'inputmode', this.isInteger() ? 'numeric' : 'decimal');
    this.renderer.setAttribute(input, 'autocomplete', 'off');

    // The decimal mark changed (the person chose another format): show the same value in it.
    effect(() => {
      this.format.numberSymbols();
      untracked(() => {
        if (!this.unreadable && this.document.activeElement !== input) this.show(this.model);
      });
    });
  }

  writeValue(value: unknown): void {
    const parsed = value === null || value === undefined || value === '' ? null : Number(value);
    this.model = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    this.unreadable = false;
    this.show(this.model);
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.renderer.setProperty(this.element.nativeElement, 'disabled', disabled);
  }

  /** `localizedNumber` when what is typed is not a number in the format in force. */
  validate(_control: AbstractControl): ValidationErrors | null {
    if (!this.unreadable) return null;
    const { decimal } = this.format.numberSymbols();
    return { localizedNumber: { decimal, example: `1234${decimal}5` } };
  }

  protected onInput(raw: string): void {
    const empty = raw.trim() === '';
    const parsed = empty ? null : this.format.parseNumber(raw);
    const wasUnreadable = this.unreadable;
    this.unreadable = !empty && parsed === null;
    this.model = parsed;
    this.onChange(parsed);
    if (wasUnreadable !== this.unreadable) this.onValidatorChange();
  }

  protected onBlur(): void {
    // «1234,50» reads «1234,5» once understood; what could not be read stays to be corrected.
    if (!this.unreadable) this.show(this.model);
    this.onTouched();
  }

  /** ↑/↓ step by `step`, within `min`/`max`, as the native control did. */
  protected step(event: Event, direction: 1 | -1): void {
    const input = this.element.nativeElement;
    if (input.disabled || input.readOnly) return;
    event.preventDefault();
    const step = Number(input.getAttribute('step')) || 1;
    const min = input.getAttribute('min');
    const max = input.getAttribute('max');
    let next = (this.model ?? 0) + direction * step;
    // Round to the step's precision: 0.1 + 0.2 must not show as 0.30000000000000004.
    const decimals = (String(step).split('.')[1] ?? '').length;
    next = Number(next.toFixed(decimals));
    if (min !== null && min !== '' && next < Number(min)) next = Number(min);
    if (max !== null && max !== '' && next > Number(max)) next = Number(max);
    this.unreadable = false;
    this.model = next;
    this.show(next);
    this.onChange(next);
  }

  private show(value: number | null): void {
    this.renderer.setProperty(this.element.nativeElement, 'value', this.format.numberForInput(value));
  }

  private isInteger(): boolean {
    const step = this.element.nativeElement.getAttribute('step');
    return step !== null && step !== 'any' && Number.isInteger(Number(step));
  }
}
