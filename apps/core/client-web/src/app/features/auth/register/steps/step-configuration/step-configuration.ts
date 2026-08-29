import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CountryService, SupportedCountry } from '../../../../../core/services/country.service';
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

  public countryService = inject(CountryService);
  private router = inject(Router);

  readonly countries = signal<SupportedCountry[]>([]);
  readonly countriesFailed = signal(false);

  readonly config = computed(() => this.countryService.currentCountry());

  /** The country's first-level divisions, when it publishes a coded catalogue. */
  readonly divisions = computed(() => this.config()?.address.divisions ?? null);

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
