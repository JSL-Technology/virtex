import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CountryService } from '../../../../../core/services/country.service';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';

@Component({
  selector: 'app-step-configuration',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, TranslateModule, AuthInputComponent],
  templateUrl: './step-configuration.html',
})
export class StepConfiguration {
  @Input() group!: FormGroup;
  public countryService = inject(CountryService);
  private translate = inject(TranslateService);
  private router = inject(Router);

  countries = [
    { code: 'DO', name: 'República Dominicana' },
    { code: 'CO', name: 'Colombia' },
    { code: 'MX', name: 'México' },
    { code: 'US', name: 'United States' },
    { code: 'PA', name: 'Panamá' },
    { code: 'CR', name: 'Costa Rica' },
    { code: 'PE', name: 'Perú' },
    { code: 'CL', name: 'Chile' }
  ];

  onFlagError(event: any) {
    event.target.src = 'assets/flags/do.svg'; // Fallback
  }

  onCountryChange(event: any) {
    const countryCode = event.target.value;

    // Update service (this will trigger the effect in RegisterPage to update form schema)
    this.countryService.getCountryConfig(countryCode).subscribe();

    // Update URL to reflect new country (so reload keeps it)
    // Current URL format: /:lang/:country/auth/register
    const currentUrl = this.router.url;
    const segments = currentUrl.split('/');
    // segments[0] is empty, [1] is lang, [2] is country
    if (segments.length > 2) {
      segments[2] = countryCode.toLowerCase();
      const newUrl = segments.join('/');
      this.router.navigateByUrl(newUrl);
    }
  }

  getTaxIdError(): string {
    const control = this.group.get('taxId');
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
      if (control.errors['pattern']) return this.countryService.currentCountry()?.formSchema?.taxId?.errorMessage || 'REGISTER.ERRORS.INVALID_FORMAT';
    }
    return '';
  }
}
