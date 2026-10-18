import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CountryConfig, CountryService } from '../../../core/services/country.service';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Save, Lock } from 'lucide-angular';
import { OrganizationProfile, OrganizationService } from '../../../shared/service/organization.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { CountryNamesService } from '../../../core/i18n/countries';
import { CountryFlagComponent } from '../../../shared/components/country-flag/country-flag.component';
import { exampleNationalNumber } from '../../../shared/utils/phone.util';
import { formatTaxId } from '../../../shared/utils/tax-id-format';

/** The industries signup offers, by stored code. The same list, so the profile can show the answer. */
const INDUSTRIES = ['TECHNOLOGY', 'RETAIL', 'MANUFACTURING', 'SERVICES', 'HEALTHCARE', 'CONSTRUCTION', 'OTHER'] as const;

/** Optional text fields: an emptied field is sent as `null`, which the API stores as "not set". */
const OPTIONAL_FIELDS = ['industry', 'address', 'city', 'state', 'postalCode', 'phone', 'website'] as const;

/**
 * Settings › Company profile.
 *
 * ## What signup collected, shown (QA A-02)
 *
 * A tenant typed its address, city, state, postal code and industry at signup and found them empty
 * here, with "Country" as a mandatory free-text box. The data had been saved all along: the API
 * answered this screen with the company HEADER, which carries none of it. It now answers with the
 * profile, and this form has a field for each of those values.
 *
 * ## The country decides the rest of the form
 *
 * Country is a select of every country, named by `Intl.DisplayNames` in the reader's language —
 * and LOCKED, with the reason, once the company's fiscal pack (chart of accounts, taxes, document
 * sequences) has been provisioned for it: the server refuses the change, so offering it was a
 * trap. The country's configuration then supplies the labels and the examples: the tax id's name
 * and format (a US EIN shows as `12-9007988`, not the stored `129007988`), the first-level
 * division's name and its catalogue, the postal code's name, and an example phone number of that
 * country. Nothing on this form assumes one market — it used to suggest «Santo Domingo» and «+1
 * (809)» to a company in Texas.
 */
@Component({
  selector: 'app-company-profile-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, TranslateModule, CountryFlagComponent, ...VX_FORM_A11Y],
  templateUrl: './company-profile.page.html',
  styleUrls: ['./company-profile.page.scss']
})
export class CompanyProfilePage implements OnInit {
  private fb = inject(FormBuilder);
  private organizationService = inject(OrganizationService);
  private notificationService = inject(NotificationService);
  private readonly countryService = inject(CountryService);
  private readonly countryNames = inject(CountryNamesService);

  protected readonly SaveIcon = Save;
  protected readonly LockIcon = Lock;
  protected readonly industries = INDUSTRIES;

  profileForm!: FormGroup;
  isLoading = false;

  /** Whether the country can still be changed; the server says. */
  readonly countryLocked = signal(false);

  /** The selected country's configuration, or null while loading / for a country with none. */
  readonly config = signal<CountryConfig | null>(null);
  private readonly configs = new Map<string, CountryConfig | null>();

  /** Every country, in the reader's language. */
  readonly countryOptions = this.countryNames.options;

  readonly selectedCountry = signal<string>('');
  readonly countryName = computed(() => this.countryNames.nameOf(this.selectedCountry()));

  /** The country's name for its fiscal identifier — EIN, RFC, RNC — when it is known. */
  readonly taxIdLabel = computed(() => this.config()?.taxIdLabel ?? '');
  readonly taxIdExample = computed(() => this.config()?.taxIdExample ?? '');
  readonly divisions = computed(() => this.config()?.address.divisions ?? null);
  readonly divisionLabel = computed(() => this.config()?.address.divisionLabel ?? '');
  readonly postalCodeLabel = computed(() => this.config()?.address.postalCodeLabel ?? '');
  readonly phoneExample = computed(() => exampleNationalNumber(this.selectedCountry()));

  ngOnInit(): void {
    this.profileForm = this.fb.group({
      legalName: ['', Validators.required],
      industry: [''],
      taxId: ['', Validators.required],
      address: [''],
      city: [''],
      state: [''],
      postalCode: [''],
      country: ['', Validators.required],
      // Not required: signup does not ask for a company phone, so requiring it here made the
      // profile impossible to save without inventing one.
      phone: [''],
      website: [''],
    });

    this.profileForm.get('country')?.valueChanges.subscribe((country: string) => this.onCountryChanged(country));

    this.loadCompanyData();
  }

  /** Load (once per country) the configuration that labels and validates the form. */
  protected onCountryChanged(countryCode: string | null | undefined): void {
    const country = (countryCode ?? '').trim().toUpperCase();
    this.selectedCountry.set(country);
    if (!country) {
      this.config.set(null);
      return;
    }
    if (this.configs.has(country)) {
      this.applyConfig(this.configs.get(country) ?? null);
      return;
    }
    this.countryService
      .getCountryConfig(country)
      .pipe(catchError(() => of(null)))
      .subscribe((config) => {
        this.configs.set(country, config);
        if (this.selectedCountry() === country) this.applyConfig(config);
      });
  }

  private applyConfig(config: CountryConfig | null): void {
    this.config.set(config);
    const taxId = this.profileForm.get('taxId');
    if (config && taxId && !taxId.dirty) {
      // The stored canonical value, written with the country's separators.
      taxId.setValue(formatTaxId(taxId.value, config.taxIdExample), { emitEvent: false });
    }
  }

  loadCompanyData(): void {
    this.isLoading = true;
    this.organizationService.getProfile().subscribe({
      next: (data) => {
        this.countryLocked.set(!!data.countryLocked);
        this.profileForm.patchValue({
          legalName: data.legalName ?? '',
          industry: data.industry ?? '',
          taxId: data.taxId ?? '',
          address: data.address ?? '',
          city: data.city ?? '',
          state: data.state ?? '',
          postalCode: data.postalCode ?? '',
          country: (data.country ?? '').toUpperCase(),
          phone: data.phone ?? '',
          website: data.website ?? '',
        });
        if (data.countryLocked) this.profileForm.get('country')?.disable({ emitEvent: false });
        this.profileForm.markAsPristine();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading company profile', error);
        this.notificationService.showError('settings.company_profile.error_loading_company_profile');
        this.isLoading = false;
      }
    });
  }

  /** An industry stored outside the signup list is still shown, as itself. */
  protected industryIsCustom(): boolean {
    const value = this.profileForm.get('industry')?.value as string;
    return !!value && !(INDUSTRIES as readonly string[]).includes(value);
  }

  saveProfile(): void {
    if (!this.profileForm.valid) return;
    this.isLoading = true;

    // Only what changed, so an untouched tax id is not re-validated, and a locked country never
    // travels. Emptied optional fields go as `null`: "" is not a URL, and not a value.
    const payload: Partial<OrganizationProfile> = {};
    for (const [name, control] of Object.entries(this.profileForm.controls)) {
      if (!control.dirty || control.disabled) continue;
      const value = typeof control.value === 'string' ? control.value.trim() : control.value;
      (payload as Record<string, unknown>)[name] =
        (OPTIONAL_FIELDS as readonly string[]).includes(name) && value === '' ? null : value;
    }

    this.organizationService.updateProfile(payload).subscribe({
      next: (data) => {
        this.notificationService.showSuccess('settings.company_profile.profile_updated_successfully');
        if (data?.taxId !== undefined) {
          this.profileForm.get('taxId')?.setValue(formatTaxId(data.taxId, this.taxIdExample()), { emitEvent: false });
        }
        this.profileForm.markAsPristine();
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error updating profile', error);
        this.notificationService.showError('settings.company_profile.error_updating_profile');
        this.isLoading = false;
      }
    });
  }
}
