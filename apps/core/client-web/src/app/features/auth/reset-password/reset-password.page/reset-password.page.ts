import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../../core/services/auth';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/services/language';
import { LucideAngularModule, Lock, AlertCircle, CheckCircle } from 'lucide-angular';

// Shared
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../../components/auth-button/auth-button.component';
import { PasswordValidatorComponent } from '../../components/password-validator/password-validator.component';
// H4 FIX: use the shared validator (single source of truth, mirrored from the backend policy)
// instead of a divergent local copy.
import { strongPasswordValidator } from '../../../../shared/validators/password.validator';

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
    LucideAngularModule,
    AuthLayoutComponent,
    AuthInputComponent,
    AuthButtonComponent,
    PasswordValidatorComponent
  ],
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss']
})
export class ResetPasswordPage implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  public languageService = inject(LanguageService);

  readonly icons = { Lock, AlertCircle, CheckCircle };

  resetPasswordForm!: FormGroup;
  isLoading = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;
  token: string | null = null;

  ngOnInit(): void {
    // H4/H-12 FIX: Read token exclusively from the URL fragment (#token=...) so it is never
    // sent to the server or stored in browser history/logs/Referer (RFC 3986 §3.5; CWE-598).
    // Clear the fragment from the address bar immediately. No ?token= query fallback.
    const fragment = this.route.snapshot.fragment ?? '';
    const match = fragment.match(/(?:^|&)token=([^&]+)/);
    this.token = match ? decodeURIComponent(match[1]) : null;
    if (this.token) {
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      this.errorMessage = 'Invalid token';
    }

    this.resetPasswordForm = this.fb.group({
      passwordGroup: this.fb.group(
        {
          password: ['', [Validators.required, strongPasswordValidator()]],
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
