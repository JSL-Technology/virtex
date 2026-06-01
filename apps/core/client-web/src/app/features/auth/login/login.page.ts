import { Component, OnInit, inject, signal, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../../../core/services/auth';
import { LanguageService } from '../../../core/services/language';
import { CountryService } from '../../../core/services/country.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RecaptchaV3Module, ReCaptchaV3Service } from 'ng-recaptcha-19';
import { LucideAngularModule, Mail, Lock, User, ArrowRight, AlertCircle, CheckCircle, ShieldCheck, Camera, Briefcase, Users, Globe, Rocket, Check, ArrowLeft } from 'lucide-angular';

// Shared Components
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { SocialAuthButtonsComponent } from '../components/social-auth-buttons/social-auth-buttons.component';
import { PasskeyButtonComponent } from '../components/passkey-button/passkey-button.component';
import { OtpComponent } from '../../../shared/components/otp/otp.component';

@Component({
  selector: 'app-login',
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
    SocialAuthButtonsComponent,
    PasskeyButtonComponent,
    OtpComponent
  ],
  providers: [ReCaptchaV3Service],
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss']
})
export class LoginPage implements OnInit {
  // Services
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private recaptchaV3Service = inject(ReCaptchaV3Service);
  private translate = inject(TranslateService);

  public languageService = inject(LanguageService);
  public countryService = inject(CountryService);

  // Icons
  readonly icons = {
    Mail,
    Lock,
    User,
    ArrowRight,
    AlertCircle,
    CheckCircle,
    ShieldCheck,
    Camera,
    Briefcase,
    Users,
    Globe,
    Rocket,
    Check,
    ArrowLeft
  };

  // State
  loginForm!: FormGroup;
  otpCodeControl = this.fb.control('', [Validators.required, Validators.minLength(6)]);

  errorMessage = signal<string | null>(null);
  isLoggingIn = signal(false);
  // H-03 FIX: show2faInput driven by server response; no tempToken stored in JS memory.
  // The pending session ID lives only in the httpOnly cookie set by the server.
  show2faInput = signal(false);

  @ViewChild(OtpComponent) otpComponent!: OtpComponent;

  ngOnInit() {
    this.countryService.detectAndSetCountry();

    this.route.paramMap.subscribe(params => {
      const lang = params.get('lang');
      if (lang) {
        this.languageService.setLanguage(lang);
      }
    });

    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
      rememberMe: [true],
    });
  }

  getErrorMessage(controlName: string): string {
    const control = this.loginForm.get(controlName);
    if (control?.touched && control?.errors) {
      let key = '';
      if (control.errors['required']) {
        key = controlName === 'email' ? 'LOGIN.ERRORS.EMAIL_REQUIRED' : 'LOGIN.ERRORS.PASSWORD_REQUIRED';
      } else if (control.errors['email']) {
        key = 'LOGIN.ERRORS.EMAIL_INVALID';
      }

      if (key) {
        return this.translate.instant(key);
      }
    }
    return '';
  }

  socialLogin(provider: string) {
    const apiUrl = `${window.location.origin}/api/v1/auth`;
    window.location.href = `${apiUrl}/${provider}`;
  }

  onLoginWithPasskey(): void {
    const email = this.loginForm.get('email')?.value;
    this.isLoggingIn.set(true);
    this.errorMessage.set(null);

    this.authService.loginWithPasskey(email || undefined)
      .then((user) => {
        if (user) {
          this.handleSuccess(user);
        }
        this.isLoggingIn.set(false);
      })
      .catch((err) => {
        // H-10 FIX: Never log full error objects in production; they may contain
        // request URLs, response bodies, or auth-flow details (OWASP Logging Cheat
        // Sheet; CWE-532). Only log in development with minimal context.
        if (!environment.production) {
          console.warn('Passkey login failed', { status: (err as any)?.status });
        }
        this.errorMessage.set('LOGIN.ERRORS.PASSKEY_ERROR');
        this.isLoggingIn.set(false);
      });
  }

  onSubmit(): void {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid) return;

    this.isLoggingIn.set(true);
    this.errorMessage.set(null);

    this.recaptchaV3Service.execute('login').subscribe({
      next: (token) => {
        const { email, password, rememberMe } = this.loginForm.getRawValue();

        this.authService.login({ email, password, recaptchaToken: token, rememberMe }).subscribe({
          next: (response: any) => {
            if (response && response.require2fa) {
              // H-03 FIX: No tempToken to store — pending session cookie was set by server.
              this.show2faInput.set(true);
              this.isLoggingIn.set(false);
            } else {
              this.handleSuccess(response);
            }
          },
          error: (err) => {
            this.handleError(err);
            this.isLoggingIn.set(false);
          }
        });
      },
      error: (err) => {
        console.error('ReCaptcha Error:', err);
        this.errorMessage.set('LOGIN.ERRORS.SERVER_ERROR');
        this.isLoggingIn.set(false);
      }
    });
  }

  verify2fa(): void {
    if (this.otpCodeControl.invalid) return;
    this.onOtpVerify(this.otpCodeControl.value!);
  }

  onOtpVerify(code: string): void {
    this.isLoggingIn.set(true);
    this.errorMessage.set(null);

    // H-03 FIX: Only the code is sent — server reads pendingId from the httpOnly cookie.
    this.authService.verify2fa(code).subscribe({
      next: (user) => {
        this.handleSuccess(user);
      },
      error: (err) => {
        this.errorMessage.set('LOGIN.ERRORS.INVALID_CODE');
        this.isLoggingIn.set(false);
        if (this.otpComponent) {
             // We can use the translation service here if needed, or pass the key.
             // But handleError expects string.
             this.translate.get('LOGIN.ERRORS.INVALID_CODE').subscribe(res => {
                  this.otpComponent.handleError(res);
             });
        }
      }
    });
  }

  private handleSuccess(user: any): void {
    if (user && user.preferredLanguage) {
      this.languageService.setLanguage(user.preferredLanguage);
    }
    this.router.navigate(['/dashboard']);
    this.isLoggingIn.set(false);
  }

  private handleError(err: any): void {
    if (!environment.production) {
      console.warn('Login failed', { status: err?.status });
    }
    if (err && err.status) {
      switch (err.status) {
        case 401: this.errorMessage.set('LOGIN.ERRORS.AUTH_INVALID_CREDENTIALS'); break;
        case 429: this.errorMessage.set('LOGIN.ERRORS.TOO_MANY_ATTEMPTS'); break;
        case 403: this.errorMessage.set('LOGIN.ERRORS.ACCOUNT_LOCKED'); break;
        default: this.errorMessage.set('LOGIN.ERRORS.SERVER_ERROR');
      }
    } else {
      this.errorMessage.set('LOGIN.ERRORS.SERVER_ERROR');
    }
  }
}
