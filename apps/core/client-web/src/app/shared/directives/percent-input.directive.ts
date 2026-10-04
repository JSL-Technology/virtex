import { Directive, ElementRef, forwardRef, inject } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * A rate field people type as a percentage, held by the form as a fraction (QA M-05).
 *
 * The API, the totals preview and every calculation in the product treat a rate as a fraction:
 * 0.18 is 18 %. The fields asked the reader for that fraction — «Desc. %» wanted 0.1 for ten per
 * cent, and typing 10 left it invalid with no message and the summary at 0.00; typing 18 in a
 * purchase order's ITBIS charged 99,000 of tax on 5,500. Nobody writes a tax as 0.18.
 *
 * This accessor is the only place the two meet: the input shows and accepts `18`, the control
 * holds `0.18`. Nothing else changes — validators, maths and the request keep speaking fractions,
 * so `Validators.max(1)` still means "at most 100 %".
 *
 *     <input type="number" vxPercent formControlName="taxRate" />
 */
@Directive({
  selector: 'input[vxPercent]',
  standalone: true,
  host: {
    inputmode: 'decimal',
    '(input)': 'onInput($any($event.target).value)',
    '(blur)': 'onTouched()',
  },
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PercentInputDirective), multi: true }],
})
export class PercentInputDirective implements ControlValueAccessor {
  private readonly element = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private onChange: (value: number | null) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(fraction: unknown): void {
    const value = fraction === null || fraction === undefined || fraction === '' ? null : Number(fraction);
    this.element.nativeElement.value = value === null || !Number.isFinite(value) ? '' : String(toPercent(value));
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.element.nativeElement.disabled = disabled;
  }

  protected onInput(raw: string): void {
    const trimmed = raw.trim().replace(',', '.');
    if (trimmed === '') {
      this.onChange(null);
      return;
    }
    const percent = Number(trimmed);
    this.onChange(Number.isFinite(percent) ? toFraction(percent) : null);
  }
}

/** 0.18 → 18, without the 18.000000000000004 that plain multiplication produces. */
export function toPercent(fraction: number): number {
  return Math.round(fraction * 100 * 1e6) / 1e6;
}

/** 18 → 0.18, rounded so 12.5 % stays 0.125 and never 0.12500000000000001. */
export function toFraction(percent: number): number {
  return Math.round((percent / 100) * 1e8) / 1e8;
}
