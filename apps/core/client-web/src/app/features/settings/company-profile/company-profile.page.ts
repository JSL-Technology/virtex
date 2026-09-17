import { Component, OnInit, inject } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CountryService } from '../../../core/services/country.service';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Save } from 'lucide-angular';
import { OrganizationService } from '../../../shared/service/organization.service';
import { NotificationService } from '../../../core/services/notification';
import { TranslateModule } from '@ngx-translate/core';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-company-profile-page',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideAngularModule, TranslateModule, ...VX_FORM_A11Y],
  templateUrl: './company-profile.page.html',
  styleUrls: ['./company-profile.page.scss']
})
export class CompanyProfilePage implements OnInit {
  private fb = inject(FormBuilder);
  private organizationService = inject(OrganizationService);
  private notificationService = inject(NotificationService);
  private readonly countryService = inject(CountryService);
  /**
   * The example identifier for the country currently selected on the form.
   *
   * The input used to carry `placeholder="Ej. 132-45678-9"` — the shape of a Dominican RNC, in
   * Spanish, written into the template — shown to a tenant in any of the nineteen markets. The
   * country's own example has always been served by `PublicCountryConfig.taxIdExample`; it just
   * was not read here.
   */
  protected taxIdExample(): string {
    const country = this.profileForm?.get('country')?.value as string | undefined;
    if (!country) return '';
    return this.countryService.currentCountry()?.countryCode === country.toUpperCase()
      ? (this.countryService.currentCountry()?.taxIdExample ?? '')
      : (this.taxIdExamples.get(country.toUpperCase()) ?? '');
  }

  /** Examples already fetched, so switching the country picker does not refetch on every render. */
  private readonly taxIdExamples = new Map<string, string>();

  /** Fetch and remember the example for a country, when the picker moves. */
  protected onCountryChanged(countryCode: string | null | undefined): void {
    const country = countryCode?.trim().toUpperCase();
    if (!country || this.taxIdExamples.has(country)) return;
    this.countryService
      .getCountryConfig(country)
      .pipe(catchError(() => of(null)))
      .subscribe((config) => {
        if (config) this.taxIdExamples.set(country, config.taxIdExample);
      });
  }


  protected readonly SaveIcon = Save;
  profileForm!: FormGroup;
  isLoading = false;

  ngOnInit(): void {
    this.profileForm = this.fb.group({
      legalName: ['', Validators.required],
      industry: [''],
      taxId: ['', Validators.required],
      address: [''],
      city: [''],
      country: ['', Validators.required],
      phone: ['', Validators.required],
      website: [''],
    });

    // The example shown in the tax-id field follows the country picker. Wired here rather
    // than in the template so the form owns its own behaviour, and so the first value —
    // set when an existing record loads — is picked up too.
    this.onCountryChanged(this.profileForm.get('country')?.value);
    this.profileForm
      .get('country')
      ?.valueChanges.subscribe((country: string) => this.onCountryChanged(country));

    this.loadCompanyData();
  }

  loadCompanyData(): void {
    this.isLoading = true;
    this.organizationService.getProfile().subscribe({
      next: (data) => {
        this.profileForm.patchValue(data);
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading company profile', error);
        this.notificationService.showError('settings.company_profile.error_loading_company_profile');
        this.isLoading = false;
      }
    });
  }

  saveProfile(): void {
    if (this.profileForm.valid) {
      this.isLoading = true;
      this.organizationService.updateProfile(this.profileForm.value).subscribe({
        next: (data) => {
          this.notificationService.showSuccess('settings.company_profile.profile_updated_successfully');
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
}
