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
import { recaptchaToken$ } from '../../../core/auth/recaptcha-token';
import { LucideAngularModule, Mail, Lock, User, ArrowRight, AlertCircle, CheckCircle, ShieldCheck, Camera, Briefcase, Users, Globe, Rocket, Check, ArrowLeft } from 'lucide-angular';

// Shared Components
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { SocialAuthButtonsComponent } from '../components/social-auth-buttons/social-auth-buttons.component';
import { PasskeyButtonComponent } from '../components/passkey-button/passkey-button.component';
import { OtpComponent } from '../../../shared/components/otp/otp.component';
import { BrandLogo } from '../../../shared/components/brand-logo/brand-logo';

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
    AuthInputComponent,
    AuthButtonComponent,
    SocialAuthButtonsComponent,
    PasskeyButtonComponent,
    OtpComponent,
    BrandLogo
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

  // Enterprise SSO (Home Realm Discovery) state.
  showSsoInput = signal(false);
  ssoChecking = signal(false);
  ssoMessage = signal<string | null>(null);
  ssoEmailControl = this.fb.control('', [Validators.required, Validators.email]);

  @ViewChild(OtpComponent) otpComponent!: OtpComponent;

  ngOnInit() {
    this.countryService.detectAndSetCountry();

    // Social / SSO callbacks redirect back here with ?error=<code> on failure.
    this.route.queryParamMap.subscribe(params => {
      const error = params.get('error');
      if (error) {
        this.errorMessage.set(this.mapSocialErrorCode(error));
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
        key = controlName === 'email' ? 'login.errors.email_required' : 'login.errors.password_required';
      } else if (control.errors['email']) {
        key = 'login.errors.email_invalid';
      }

      if (key) {
        return this.translate.instant(key);
      }
    }
    return '';
  }

  socialLogin(provider: string) {
    if (provider === 'sso') {
      // Open the Home Realm Discovery panel; prefill with the email already typed, if any.
      this.ssoMessage.set(null);
      const typedEmail = this.loginForm?.get('email')?.value;
      if (typedEmail) {
        this.ssoEmailControl.setValue(typedEmail);
      }
      this.showSsoInput.set(true);
      return;
    }
    const apiUrl = `${window.location.origin}/api/v1/auth`;
    window.location.href = `${apiUrl}/${provider}`;
  }

  /** Resolve the org SSO connection for the entered email and redirect to its IdP. */
  startSso(): void {
    this.ssoEmailControl.markAsTouched();
    if (this.ssoEmailControl.invalid) return;

    this.ssoChecking.set(true);
    this.ssoMessage.set(null);

    this.authService.discoverSso(this.ssoEmailControl.value!).subscribe({
      next: (res) => {
        this.ssoChecking.set(false);
        if (res.ssoAvailable && res.startUrl) {
          // startUrl is a server-relative path; resolve against the current origin.
          window.location.href = res.startUrl.startsWith('http')
            ? res.startUrl
            : `${window.location.origin}${res.startUrl}`;
        } else {
          this.ssoMessage.set('login.sso.not_found');
        }
      },
      error: () => {
        this.ssoChecking.set(false);
        this.ssoMessage.set('login.sso.not_found');
      },
    });
  }

  cancelSso(): void {
    this.showSsoInput.set(false);
    this.ssoMessage.set(null);
  }

  /** Map a backend social/SSO error code to a translation key shown in the error banner. */
  private mapSocialErrorCode(code: string): string {
    switch (code) {
      case 'account_exists':
        return 'login.errors.social_account_exists';
      case 'email_not_verified':
        return 'login.errors.social_email_not_verified';
      case 'account_inactive':
        return 'errors.auth_account_locked';
      case 'provider_unavailable':
      case 'sso_unavailable':
        return 'login.errors.social_unavailable';
      default:
        return 'login.errors.social_failed';
    }
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
        // H14/H-10 FIX: Never log full error objects in production; they may contain
        // request URLs, response bodies, or auth-flow details (OWASP Logging Cheat
        // Sheet; CWE-532). Only log in development with minimal context.
        if (!environment.production) {
          console.warn('Passkey login failed', { status: (err as any)?.status });
        }
        this.errorMessage.set('login.errors.passkey_error');
        this.isLoggingIn.set(false);
      });
  }

  onSubmit(): void {
    this.loginForm.markAllAsTouched();
    if (this.loginForm.invalid) return;

    this.isLoggingIn.set(true);
    this.errorMessage.set(null);

    recaptchaToken$(this.recaptchaV3Service, 'login').subscribe({
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
      error: () => {
        this.errorMessage.set('errors.internal');
        this.isLoggingIn.set(false);
      }
    });
  }

  /**
   * Cierra el segundo factor y devuelve al usuario al formulario intacto.
   *
   * Limpia además el mensaje de error: si llegó por un código equivocado, ese
   * texto no describe el estado del formulario de credenciales al que se
   * vuelve, y dejarlo puesto hace pensar que las credenciales fallaron.
   */
  closeTwoFactor(): void {
    this.show2faInput.set(false);
    this.errorMessage.set(null);
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
        this.errorMessage.set('errors.auth_two_factor_invalid');
        this.isLoggingIn.set(false);
        if (this.otpComponent) {
             // We can use the translation service here if needed, or pass the key.
             // But handleError expects string.
             this.translate.get('errors.auth_two_factor_invalid').subscribe(res => {
                  this.otpComponent.handleError(res);
             });
        }
      }
    });
  }

  /**
   * The language is NOT applied here.
   *
   * `AuthService.applyAuthenticated` is the one funnel every path into a signed-in state goes
   * through — bootstrap, refresh, login, 2FA, invitation, impersonation — and it applies the
   * account's language and the tenant's locale context there. Doing it again here would mean two
   * places that have to agree, and the five paths that do NOT come through this method would
   * still be missing it.
   */
  private handleSuccess(user: unknown): void {
    void user;
    this.router.navigate(['/overview']);
    this.isLoggingIn.set(false);
  }

  private handleError(err: any): void {
    if (!environment.production) {
      console.warn('Login failed', { status: err?.status });
    }
    if (err && err.status) {
      switch (err.status) {
        case 401: this.errorMessage.set('errors.auth_invalid_credentials'); break;
        case 429: this.errorMessage.set('errors.http_429'); break;
        case 403: this.errorMessage.set('errors.auth_account_locked'); break;
        default: this.errorMessage.set('errors.internal');
      }
    } else {
      this.errorMessage.set('errors.internal');
    }
  }
}
