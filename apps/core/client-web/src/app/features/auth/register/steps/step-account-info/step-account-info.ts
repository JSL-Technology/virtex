import { Component, Input, computed, inject, OnInit } from '@angular/core';
import { CountryService } from '../../../../../core/services/country.service';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { AuthInputComponent } from '../../../components/auth-input/auth-input.component';
import { IntlPhoneInputComponent } from '../../../../../shared/components/intl-phone-input/intl-phone-input.component';
import { PasswordStrengthComponent } from '../../../../../shared/components/password-strength/password-strength.component';
import { HttpClient } from '@angular/common/http';
import { AsyncValidators } from '../../../../../shared/validators/async.validators';
import { LucideAngularModule, User, Mail, Lock, Phone, AlertCircle } from 'lucide-angular';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-step-account-info',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    AuthInputComponent,
    IntlPhoneInputComponent,
    PasswordStrengthComponent,
    LucideAngularModule,
    ...VX_FORM_A11Y,
  ],
  templateUrl: './step-account-info.html',
  styleUrls: ['./step-account-info.scss'],
})
export class StepAccountInfo implements OnInit {
  @Input() group!: FormGroup;
  private http = inject(HttpClient);
  private readonly countryService = inject(CountryService);

  /** The country being signed up in: the phone field starts there (QA A-12). */
  readonly signupCountry = computed(() => this.countryService.currentCountry()?.countryCode ?? null);

  readonly UserIcon = User;
  readonly MailIcon = Mail;
  readonly LockIcon = Lock;
  readonly PhoneIcon = Phone;
  readonly AlertCircleIcon = AlertCircle;

  ngOnInit() {
    if (this.group) {
      const emailControl = this.group.get('email');
      if (emailControl) {
        // No live "is this email taken?" check: the endpoint behind it was an unauthenticated
        // account-enumeration oracle. Uniqueness is enforced when the form is submitted.
        emailControl.updateValueAndValidity();
      }
    }
  }

  getErrorMessage(controlName: string): string {
    const control = this.group.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'register.errors.required';
      if (control.errors['email']) return 'register.errors.email_invalid';
      if (control.errors['emailExists']) return 'register.errors.email_exists';
      if (control.errors['minlength']) return 'register.errors.password_length';
      if (control.errors['strongPassword']) return 'register.errors.password_weak';
      if (control.errors['passwordMismatch']) return 'register.errors.password_mismatch';
    }
    return '';
  }
}
