import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import {
  CountryService,
  type FiscalFieldSpec,
  type SupportedCountry,
  type TaxpayerKind,
} from '../../../../../core/services/country.service';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';

/**
 * The fiscal identity step: country, tax id, and the fiscal address.
 *
 * Three things changed here, and all three were correctness rather than presentation.
 *
 *   1. The country list was hardcoded to eight entries in this component, disagreeing with the six
 *      seeded on the server and the three in `libs/api/country`. Choosing Costa Rica or Peru — both
 *      offered here — produced a tenant with no fiscal region, no chart of accounts and no taxes,
 *      and the signup still reported success. The list now comes from the server.
 *   2. The tax-id label and placeholder were read from `formSchema`, a field no backend strategy
 *      ever populated, so every country showed the generic label and an empty placeholder.
 *   3. There was no address beyond a free-text line on a later step. No electronic-invoicing regime
 *      in these markets can be satisfied from that, and United States sales tax cannot be computed
 *      without a state and a ZIP.
 */
@Component({
  selector: 'app-step-configuration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, AuthInputComponent],
  templateUrl: './step-configuration.html',
  styleUrls: ['./step-configuration.scss'],
})
export class StepConfiguration {
  @Input() group!: FormGroup;

  /** Raised when the taxpayer kind changes, so the parent can rebuild the fiscal controls. */
  @Output() taxpayerKindChanged = new EventEmitter<void>();

  public countryService = inject(CountryService);
  private router = inject(Router);

  readonly countries = signal<SupportedCountry[]>([]);
  readonly countriesFailed = signal(false);

  readonly config = computed(() => this.countryService.currentCountry());

  /** The country's first-level divisions, when it publishes a coded catalogue. */
  readonly divisions = computed(() => this.config()?.address.divisions ?? null);

  /** Whether this country issues a different identifier to companies and to natural persons. */
  readonly taxpayerKindRequired = computed(() => this.config()?.taxpayerKindRequired ?? false);

  /** The country's extra fiscal fields, filtered to the taxpayer kind currently selected. */
  readonly fiscalFields = computed<FiscalFieldSpec[]>(() => {
    const kind = this.selectedKind();
    return (this.config()?.fiscalFields ?? []).filter(
      (field) => !field.appliesTo || !kind || field.appliesTo.includes(kind),
    );
  });

  /**
   * What the product can actually do for this market today.
   *
   * The step used to say "{{country}} exige facturación electrónica ({{regime}}). Estos datos
   * forman parte del comprobante, por eso los pedimos ahora" for every country whose law requires
   * e-invoicing — including twelve with no adapter behind them. That is a promise the product
   * cannot keep, made to somebody who is about to pay. Now the notice distinguishes the two cases.
   */
  readonly invoicingSupported = computed(() => this.config()?.marketStatus === 'available');

  readonly taxIdLabel = computed(() => this.config()?.taxIdLabel ?? 'Tax ID');
  readonly taxIdPlaceholder = computed(() => this.config()?.taxIdExample ?? '');
  readonly divisionLabel = computed(() => this.config()?.address.divisionLabel ?? 'Provincia');
  readonly postalCodeLabel = computed(() => this.config()?.address.postalCodeLabel ?? 'Código postal');
  readonly postalCodeRequired = computed(() => this.config()?.address.postalCodeRequired ?? false);

  /**
   * What the country's e-invoicing regime demands, shown so the tenant understands why the fiscal
   * address is being asked for rather than experiencing it as bureaucracy.
   */
  readonly invoicingNotice = computed(() => {
    const invoicing = this.config()?.electronicInvoicing;
    return invoicing?.required ? invoicing.regime : null;
  });

  constructor() {
    this.countryService.getSupportedCountries().subscribe({
      next: (countries) => {
        this.countries.set(countries);
        this.countriesFailed.set(false);
      },
      // No hardcoded fallback list. Offering a country the server cannot provision is the exact
      // failure this replaces; an honest error is better than a signup that cannot complete.
      error: () => this.countriesFailed.set(true),
    });
  }

  /** The taxpayer kind currently chosen, read reactively so the field list follows it. */
  private readonly kindSignal = signal<TaxpayerKind | undefined>('company');
  readonly selectedKind = this.kindSignal.asReadonly();

  onTaxpayerKindChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as TaxpayerKind;
    this.kindSignal.set(value);
    this.taxpayerKindChanged.emit();
  }

  /** Options of one select, filtered to the taxpayer kind. */
  optionsFor(field: FiscalFieldSpec) {
    const kind = this.selectedKind();
    return (field.options ?? []).filter(
      (option) => !option.appliesTo || !kind || option.appliesTo.includes(kind),
    );
  }

  /** The dynamic fiscal-field group, for the template's `formGroupName`. */
  get fiscalProfileGroup(): FormGroup {
    return this.group.get('fiscalProfile') as FormGroup;
  }

  errorForFiscalField(key: string): string {
    const control = this.fiscalProfileGroup?.get(key);
    if (!control?.touched || !control.errors) return '';
    if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
    return 'REGISTER.ERRORS.INVALID_FORMAT';
  }

  onFlagError(event: Event) {
    (event.target as HTMLImageElement).src = 'assets/flags/do.svg';
  }

  onCountryChange(event: Event) {
    const countryCode = (event.target as HTMLSelectElement).value;
    this.countryService.getCountryConfig(countryCode).subscribe({ error: () => undefined });

    // Keep the URL in step with the selection, so a reload preserves it.
    // URL shape: /:lang/:country/auth/register
    const segments = this.router.url.split('/');
    if (segments.length > 2) {
      segments[2] = countryCode.toLowerCase();
      this.router.navigateByUrl(segments.join('/'));
    }
  }

  errorFor(controlName: string): string {
    const control = this.group.get(controlName);
    if (!control?.touched || !control.errors) return '';
    if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
    if (control.errors['pattern']) return 'REGISTER.ERRORS.INVALID_FORMAT';
    return 'REGISTER.ERRORS.INVALID_FORMAT';
  }

  /** Kept for the template's tax-id field, which has a country-specific hint. */
  getTaxIdError(): string {
    const control = this.group.get('taxId');
    if (control?.touched && control.errors?.['pattern']) {
      const config = this.config();
      return config ? `Formato esperado: ${config.taxIdExample}` : 'REGISTER.ERRORS.INVALID_FORMAT';
    }
    return this.errorFor('taxId');
  }
}
