import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../../core/services/auth';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/services/language';

// Shared
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../../components/auth-button/auth-button.component';
import { PasswordValidatorComponent } from '../../components/password-validator/password-validator.component';

// Custom validator for strong password
const strongPasswordValidator = (): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    const v: string = control.value || '';
    const ok =
      /[a-z]/.test(v) &&
      /[A-Z]/.test(v) &&
      /[0-9]/.test(v) &&
      /[!@#$%^&*(),.?":{}|<>]/.test(v);
    return ok ? null : { strongPassword: true };
  };
};

const passwordMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
};

@Component({
  selector: 'app-reset-password-page',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    TranslateModule,
    AuthLayoutComponent,
    AuthInputComponent,
    AuthButtonComponent,
    PasswordValidatorComponent
  ],
  templateUrl: './reset-password.page.html'
})
export class ResetPasswordPage implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  public languageService = inject(LanguageService);

  resetPasswordForm!: FormGroup;
  isLoading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  token: string | null = null;

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.errorMessage = "Invalid token";
    }

    this.resetPasswordForm = this.fb.group({
      passwordGroup: this.fb.group(
        {
          password: ['', [Validators.required, Validators.minLength(8), strongPasswordValidator()]],
          confirmPassword: ['', Validators.required],
        },
        { validators: passwordMatchValidator }
      )
    });
  }

  getErrorMessage(controlName: string): string {
     // Implement simple error mapping if needed, handled mostly in template
     const control = this.resetPasswordForm.get(controlName);
     if (control?.touched && control.errors) {
         if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
         if (control.errors['minlength']) return 'REGISTER.ERRORS.PASSWORD_LENGTH';
     }
     return '';
  }

  onSubmit() {
    if (this.resetPasswordForm.invalid || !this.token) {
      this.resetPasswordForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;
    this.successMessage = null;

    const newPassword = this.resetPasswordForm.value.passwordGroup.password;

    this.authService.resetPassword(this.token, newPassword).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = 'RESET_PASSWORD.SUCCESS';
        setTimeout(() => this.router.navigate(['/', this.languageService.currentLang(), 'auth', 'login']), 3000);
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.customMessage || 'RESET_PASSWORD.ERRORS.INVALID_TOKEN';
      }
    });
  }
}
