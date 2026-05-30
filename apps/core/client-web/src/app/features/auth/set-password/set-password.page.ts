import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth';
import { TranslateModule } from '@ngx-translate/core';
import { ReCaptchaV3Service, RecaptchaV3Module, RECAPTCHA_V3_SITE_KEY } from 'ng-recaptcha-19';
import { environment } from '../../../../environments/environment';
import { LucideAngularModule, Lock, AlertCircle } from 'lucide-angular';

// Shared
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { PasswordValidatorComponent } from '../components/password-validator/password-validator.component';

const strongPasswordValidator = (): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    const v: string = control.value || '';
    const ok = /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v) && /[!@#$%^&*(),.?":{}|<>]/.test(v);
    return ok ? null : { strongPassword: true };
  };
};

const passwordMatchValidator: ValidatorFn = (group: AbstractControl): ValidationErrors | null => {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
};

@Component({
  selector: 'app-set-password',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterModule,
    TranslateModule,
    RecaptchaV3Module,
    LucideAngularModule,
    AuthLayoutComponent,
    AuthInputComponent,
    AuthButtonComponent,
    PasswordValidatorComponent
  ],
  providers: [
    ReCaptchaV3Service,
    { provide: RECAPTCHA_V3_SITE_KEY, useValue: environment.recaptcha.siteKey }
  ],
  templateUrl: './set-password.page.html',
  styleUrls: ['./set-password.page.scss']
})
export class SetPasswordPage implements OnInit {
  private fb = inject(FormBuilder);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private authService = inject(AuthService);
  private recaptchaV3Service = inject(ReCaptchaV3Service);

  readonly icons = { Lock, AlertCircle };

  setPasswordForm!: FormGroup;
  isLoading = false;
  errorMessage: string | null = null;
  token: string | null = null;

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token');
    
    this.setPasswordForm = this.fb.group({
      passwordGroup: this.fb.group({
        password: ['', [Validators.required, Validators.minLength(8), strongPasswordValidator()]],
        confirmPassword: ['', Validators.required],
      }, { validators: passwordMatchValidator })
    });

    if (this.token) {
      // Optional: Check validity first or just let submit handle it
      // this.authService.getInvitationDetails(this.token)...
    } else {
      this.errorMessage = 'Invalid Token';
    }
  }

  getErrorMessage(controlName: string): string {
     const control = this.setPasswordForm.get(controlName);
     if (control?.touched && control.errors) {
         if (control.errors['required']) return 'REGISTER.ERRORS.REQUIRED';
         if (control.errors['minlength']) return 'REGISTER.ERRORS.PASSWORD_LENGTH';
     }
     return '';
  }

  onSubmit() {
    if (this.setPasswordForm.invalid || !this.token) {
      this.setPasswordForm.markAllAsTouched();
      return;
    }

    this.isLoading = true;
    this.errorMessage = null;

    const password = this.setPasswordForm.value.passwordGroup.password;

    this.recaptchaV3Service.execute('setPassword').subscribe({
        next: (token) => {
            this.authService.setPasswordFromInvitation(this.token!, password).subscribe({
                next: () => {
                    this.router.navigate(['/dashboard']);
                },
                error: (err: any) => {
                    this.isLoading = false;
                    this.errorMessage = err.message || 'Error setting password';
                }
            });
        },
        error: () => {
            this.isLoading = false;
            this.errorMessage = 'ReCaptcha Error';
        }
    });
  }
}
