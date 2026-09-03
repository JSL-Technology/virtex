import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnInit,
  computed,
  forwardRef,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  ControlValueAccessor,
  NG_VALIDATORS,
  NG_VALUE_ACCESSOR,
  ValidationErrors,
  Validator,
} from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { CountryService, SupportedCountry } from '../../../core/services/country.service';
import { callingCodeForRegion, formatNational, isValidPhone, regionForE164, toE164 } from '../../utils/phone.util';

/**
 * An international phone field that always produces E.164.
 *
 * The registration and profile forms collected a free-text `type="tel"` value and sent it straight
 * to endpoints whose validators demand E.164 (`IsVerificationTarget`, `IsE164PhoneNumber`). A human
 * types a national number, so every one of them was rejected with a 400 before an SMS was ever
 * attempted, and phone verification could not be completed at all.
 *
 * This component removes the whole failure mode: the user picks a country and types their national
 * number, and the control's value is the E.164 string the API expects. Validation uses the SAME
 * library the server does (`google-libphonenumber`), so what the form accepts is what the API
 * accepts. The country list comes from `getSupportedCountries()` — the markets the product actually
 * serves — so opening a new market is one backend change, not an edit here.
 *
 * It is a `ControlValueAccessor` and a `Validator`: bind it with `formControlName` and the control
 * holds E.164 and reports `{ invalidPhone: true }` for anything that is not a real number.
 */
@Component({
  selector: 'app-intl-phone-input',
  standalone: true,
  imports: [CommonModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => IntlPhoneInputComponent), multi: true },
    { provide: NG_VALIDATORS, useExisting: forwardRef(() => IntlPhoneInputComponent), multi: true },
  ],
  templateUrl: './intl-phone-input.component.html',
  styleUrls: ['./intl-phone-input.component.scss'],
})
export class IntlPhoneInputComponent implements ControlValueAccessor, Validator, OnInit {
  @Input() label = '';
  @Input() required = false;
  @Input() placeholder = '';
  @Input() inputId = `phone-${Math.random().toString(36).slice(2, 9)}`;

  private readonly countryService = inject(CountryService);

  /** The markets the product serves, each with its ISO code and calling code. */
  readonly countries = toSignal(this.countryService.getSupportedCountries(), {
    initialValue: [] as SupportedCountry[],
  });

  /** The selected ISO region (`DO`, `MX`, …) and the national number the user is typing. */
  readonly region = signal<string>('DO');
  readonly national = signal<string>('');
  readonly disabled = signal(false);
  readonly touched = signal(false);

  /** `+1`, `+52`, … derived from the selected region, shown as a fixed prefix. */
  readonly dialCode = computed(() => callingCodeForRegion(this.region()));

  /** Whether to surface the inline validation message (only after the field has been touched). */
  readonly showError = computed(() => {
    if (!this.touched()) return false;
    const raw = this.national().trim();
    if (!raw) return this.required;
    return !isValidPhone(raw, this.region());
  });

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private onValidatorChange: () => void = () => undefined;

  ngOnInit(): void {
    // Default to the country detected for this visitor, so most users never touch the selector.
    const detected = (this.countryService.currentCountryCode() || 'do').toUpperCase();
    this.region.set(detected);
  }

  // -- ControlValueAccessor ------------------------------------------------------------------

  writeValue(value: string | null): void {
    const incoming = (value ?? '').trim();
    if (incoming.startsWith('+')) {
      const iso = regionForE164(incoming);
      if (iso) this.region.set(iso);
      this.national.set(formatNational(incoming, iso ?? this.region()));
    } else {
      this.national.set(incoming);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  registerOnValidatorChange(fn: () => void): void {
    this.onValidatorChange = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // -- Validator -----------------------------------------------------------------------------

  validate(control: AbstractControl): ValidationErrors | null {
    const value = (control.value ?? '').toString().trim();
    if (!value) return this.required ? { required: true } : null;
    return isValidPhone(value, this.region()) ? null : { invalidPhone: true };
  }

  // -- Template handlers ---------------------------------------------------------------------

  onRegionChange(iso: string): void {
    this.region.set(iso);
    this.emit();
    // The same digits can be valid in one country and invalid in another, so re-run validation.
    this.onValidatorChange();
  }

  onNationalInput(value: string): void {
    this.national.set(value);
    this.emit();
  }

  markTouched(): void {
    if (!this.touched()) {
      this.touched.set(true);
      this.onTouched();
    }
  }

  /**
   * Push the current value to the form as E.164 when it is a valid number, and as the raw text
   * otherwise — so an incomplete number keeps what the user typed on screen while the validator
   * marks the control invalid, rather than silently emptying the field.
   */
  private emit(): void {
    const raw = this.national().trim();
    if (!raw) {
      this.onChange('');
      return;
    }
    this.onChange(toE164(raw, this.region()) ?? raw);
  }
}
