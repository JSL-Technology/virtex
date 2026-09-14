import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../../core/services/auth';
import { RECAPTCHA_V3_SITE_KEY, RecaptchaV3Module, ReCaptchaV3Service } from 'ng-recaptcha-19';
import { recaptchaToken$ } from '../../../../core/auth/recaptcha-token';
import { environment } from '../../../../../environments/environment';
import { switchMap } from 'rxjs/operators';
import { LanguageService } from '../../../../core/services/language';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, Mail, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-angular';

// Shared Components
import { AuthInputComponent } from '../../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../../components/auth-button/auth-button.component';
import { BrandLogo } from '../../../../shared/components/brand-logo/brand-logo';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RecaptchaV3Module,
    RouterModule,
    TranslateModule,
    LucideAngularModule,
    AuthInputComponent,
    AuthButtonComponent,
    BrandLogo,
    ...VX_FORM_A11Y,
  ],
  providers: [
    ReCaptchaV3Service,
    { provide: RECAPTCHA_V3_SITE_KEY, useValue: environment.recaptcha.siteKey }
  ],
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss']
})
export class ForgotPasswordPage {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private recaptchaV3Service = inject(ReCaptchaV3Service);
  public languageService = inject(LanguageService);

  readonly icons = { Mail, AlertCircle, CheckCircle, ArrowLeft };

  forgotPasswordForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });

  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  getErrorMessage(controlName: string): string {
    const control = this.forgotPasswordForm.get(controlName);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'login.errors.email_required';
      if (control.errors['email']) return 'login.errors.email_invalid';
    }
    return '';
  }

  onSubmit() {
    if (this.forgotPasswordForm.invalid) {
      this.forgotPasswordForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    recaptchaToken$(this.recaptchaV3Service, 'forgotPassword').pipe(
      switchMap((recaptchaToken) => {
        const email = this.forgotPasswordForm.value.email!;
        return this.authService.forgotPassword(email, recaptchaToken);
      })
    ).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        this.successMessage.set('forgot_password.success'); // Will be translated in template
        this.forgotPasswordForm.reset();
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set('errors.internal');
      }
    });
  }
}
