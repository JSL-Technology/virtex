import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../../core/services/auth';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/services/language';
import { LucideAngularModule, Lock, AlertCircle, CheckCircle } from 'lucide-angular';

// Shared
import { AuthInputComponent } from '../../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../../components/auth-button/auth-button.component';
import { PasswordStrengthComponent } from '../../../../shared/components/password-strength/password-strength.component';
import { BrandLogo } from '../../../../shared/components/brand-logo/brand-logo';
// H4 FIX: use the shared validator (single source of truth, mirrored from the backend policy)
// instead of a divergent local copy.
import { strongPasswordValidator } from '../../../../shared/validators/password.validator';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

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
    AuthInputComponent,
    AuthButtonComponent,
    PasswordStrengthComponent,
    BrandLogo,
    ...VX_FORM_A11Y,
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

  /**
   * Whether the server has told us this account needs its second factor to complete the reset.
   *
   * Asked for only when the server says so, rather than always: the client cannot know whether an
   * account has 2FA without being told, and asking everybody "enter your code (if you have one)"
   * is how a prompt stops meaning anything. The server answers `auth.2_fa_verification_required`
   * on the first attempt and the field appears.
   */
  requiresTwoFactor = false;

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
      ),
      // Revealed by `requiresTwoFactor`. No validator until then, so the form is not blocked by a
      // field the account may not need; `requireTwoFactor()` adds it when the server asks.
      twoFactorCode: [''],
    });
  }

  getErrorMessage(controlName: string): string {
     // Implement simple error mapping if needed, handled mostly in template
     const control = this.resetPasswordForm.get(controlName);
     if (control?.touched && control.errors) {
         if (control.errors['required']) return 'register.errors.required';
         if (control.errors['minlength']) return 'register.errors.password_length';
     }
     return '';
  }

  /** Reveal the second-factor field and make it required, once the server has asked for it. */
  private requireTwoFactor(): void {
    this.requiresTwoFactor = true;
    const control = this.resetPasswordForm.get('twoFactorCode');
    control?.setValidators([Validators.required]);
    control?.updateValueAndValidity();
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
    const twoFactorCode: string = (this.resetPasswordForm.value.twoFactorCode ?? '').trim();

    this.authService.resetPassword(this.token, newPassword, twoFactorCode || undefined).subscribe({
      next: () => {
        this.isLoading = false;
        this.successMessage = 'reset_password.success';
        setTimeout(() => this.router.navigate(['/', this.languageService.currentLang(), 'auth', 'login']), 3000);
      },
      error: (err) => {
        this.isLoading = false;

        // The account has a second factor and the server wants it. Asking for it is the whole
        // point — recovery is the one flow that could otherwise replace a credential on mailbox
        // access alone — so this is a prompt, not a failure.
        if (err?.messageKey === 'auth.2_fa_verification_required' && !this.requiresTwoFactor) {
          this.requireTwoFactor();
          this.errorMessage = 'reset_password.two_factor_required';
          return;
        }

        if (err?.messageKey === 'auth.invalid_2_fa_code') {
          this.errorMessage = 'reset_password.two_factor_invalid';
          return;
        }

        // `customMessage` never existed on AppError, so this fallback was the only branch that
        // ever ran. `message` is the sentence the error handler already resolved.
        this.errorMessage = err.message || 'reset_password.errors.invalid_token';
      }
    });
  }
}
