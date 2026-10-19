import { visitorRegion } from '../../../core/i18n/visitor-region';
import { TranslateModule, LocaleStore } from '@virteex/shared/ui-i18n';
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

import { CountryService, SupportedCountry } from '../../../core/services/country.service';
import { callingCodeForRegion, exampleNationalNumber, formatNational, isValidPhone, regionForE164, toE164 } from '../../utils/phone.util';
import { CountryNamesService } from '../../../core/i18n/countries';

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
  /**
   * An explicit placeholder. Left empty, the field shows an example number OF THE SELECTED
   * COUNTRY, from libphonenumber — a fixed example is always some country's, and the signup's was
   * Dominican for everybody (QA A-12).
   */
  @Input() placeholder = '';

  /**
   * The country to start on, and to follow while the person has not chosen one themselves.
   *
   * The signup passes the country being registered in (QA A-12): a US company's form opened on the
   * Dominican Republic, and a Mexican one read «República Dominicana» next to `+52`, because the
   * field picked its own default before the signup's country had loaded and never looked again.
   */
  @Input() set defaultRegion(value: string | null | undefined) {
    const code = (value ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return;
    this.suggestedRegion = code;
    if (!this.regionChosen && !this.national().trim()) {
      this.region.set(code);
      this.onValidatorChange();
    }
  }
  private suggestedRegion: string | null = null;
  /** True once the person picked a country, or a stored number fixed one. */
  private regionChosen = false;
  @Input() inputId = `phone-${Math.random().toString(36).slice(2, 9)}`;

  private readonly countryService = inject(CountryService);
  private readonly localeStore = inject(LocaleStore);
  private readonly countryNames = inject(CountryNamesService);

  /** The markets the product serves, each with its ISO code and calling code. */
  readonly countries = toSignal(this.countryService.getSupportedCountries(), {
    initialValue: [] as SupportedCountry[],
  });

  /** The selected ISO region (`DO`, `MX`, …) and the national number the user is typing. */
  readonly region = signal<string>('');
  readonly national = signal<string>('');
  readonly disabled = signal(false);
  readonly touched = signal(false);

  /**
   * The served countries named in the READER'S language and sorted as it sorts (QA A-12). The API
   * names them in one language for everybody, so an English page listed «República Dominicana».
   */
  readonly countryOptions = computed(() => {
    const collator = new Intl.Collator(this.localeStore.locale(), { sensitivity: 'base' });
    return this.countries()
      .map((c) => ({ code: c.countryCode, callingCode: c.callingCode, name: this.countryNames.nameOf(c.countryCode) || c.name }))
      .sort((a, b) => collator.compare(a.name, b.name));
  });

  /** The selected country's example number, for the placeholder. */
  readonly example = computed(() => exampleNationalNumber(this.region()));

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
    // Default to the company's country, else the one detected for this visitor, else the one their
    // browser's language suggests — so most users never touch the selector, wherever they are.
    const tenant = this.localeStore.tenantContext()?.countryCode;
    const detected =
      this.suggestedRegion || tenant || this.countryService.currentCountryCode() || visitorRegion() || '';
    if (!this.region()) this.region.set(detected.toUpperCase());
  }

  // -- ControlValueAccessor ------------------------------------------------------------------

  writeValue(value: string | null): void {
    const incoming = (value ?? '').trim();
    if (incoming.startsWith('+')) {
      const iso = regionForE164(incoming);
      if (iso) {
        this.region.set(iso);
        this.regionChosen = true;
      }
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
    this.regionChosen = true;
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
