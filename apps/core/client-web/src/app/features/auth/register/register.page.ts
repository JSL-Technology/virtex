import {
  Component,
  OnInit,
  inject,
  signal,
  effect,
  computed,
} from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  AbstractControl,
  ValidationErrors,
  ReactiveFormsModule,
} from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import {
  LucideAngularModule,
  CheckCircle,
  BarChart2,
  Package,
  Check,
  ArrowLeft,
  ArrowRight,
  Rocket,
  AlertCircle,
} from 'lucide-angular';
import { trigger, style, transition, animate } from '@angular/animations';
import { AuthService } from '../../../core/services/auth';
import { RegisterPayload } from '../../../shared/interfaces/register-payload.interface';
import { StepAccountInfo } from './steps/step-account-info/step-account-info';
import { StepEmailVerify } from './steps/step-email-verify/step-email-verify';
import { StepPhoneVerify } from './steps/step-phone-verify/step-phone-verify';
import { StepBusiness } from './steps/step-business/step-business';
import { StepConfiguration } from './steps/step-configuration/step-configuration';
import { StepPlan } from './steps/step-plan/step-plan';
import { strongPasswordValidator } from '../../../shared/validators/password.validator';
import {
  RECAPTCHA_V3_SITE_KEY,
  RecaptchaV3Module,
  ReCaptchaV3Service,
} from 'ng-recaptcha-19';
import { environment } from '../../../../environments/environment';
import { CountryService } from '../../../core/services/country.service';
import { GeoMismatchModalComponent } from '../../../shared/components/geo-mismatch-modal/geo-mismatch-modal.component';
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { LanguageService } from '../../../core/services/language';

const FORM_DRAFT_KEY = 'register_form_draft';
const TOTAL_STEPS = 6;

export function passwordMatchValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirmPassword = control.get('confirmPassword')?.value;
  return password === confirmPassword ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    LucideAngularModule,
    RouterLink,
    StepAccountInfo,
    StepEmailVerify,
    StepPhoneVerify,
    StepBusiness,
    StepConfiguration,
    StepPlan,
    RecaptchaV3Module,
    GeoMismatchModalComponent,
    AuthLayoutComponent,
    AuthButtonComponent,
    AuthInputComponent,
  ],
  providers: [
    ReCaptchaV3Service,
    { provide: RECAPTCHA_V3_SITE_KEY, useValue: environment.recaptcha.siteKey },
  ],
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  animations: [
    trigger('stepAnimation', [
      transition(':increment', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate(
          '300ms ease-out',
          style({ transform: 'translateX(0)', opacity: 1 }),
        ),
      ]),
      transition(':decrement', [
        style({ transform: 'translateX(-100%)', opacity: 0 }),
        animate(
          '300ms ease-out',
          style({ transform: 'translateX(0)', opacity: 1 }),
        ),
      ]),
    ]),
  ],
})
export class RegisterPage implements OnInit {
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly BarChart2Icon = BarChart2;
  protected readonly PackageIcon = Package;
  protected readonly CheckIcon = Check;
  protected readonly ArrowLeftIcon = ArrowLeft;
  protected readonly ArrowRightIcon = ArrowRight;
  protected readonly RocketIcon = Rocket;
  protected readonly AlertCircleIcon = AlertCircle;

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);
  private recaptchaV3Service = inject(ReCaptchaV3Service);
  public countryService = inject(CountryService);
  public languageService = inject(LanguageService);

  currentStep = signal(1);
  registerForm!: FormGroup;
  errorMessage = signal<string | null>(null);
  isRegistering = signal(false);
  stepsCompleted = signal<boolean[]>(new Array(TOTAL_STEPS).fill(false));

  emailVerified = signal(false);
  phoneVerified = signal(false);

  readonly steps = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1);

  currentCountryConfig = computed(() => this.countryService.currentCountry());

  get currentEmail(): string {
    return this.registerForm?.get('accountInfo.email')?.value ?? '';
  }

  get currentPhone(): string {
    return this.registerForm?.get('accountInfo.phone')?.value ?? '';
  }

  constructor() {
    effect(() => {
      const config = this.currentCountryConfig();
      if (config && this.registerForm) {
        const taxIdControl = this.registerForm.get('configuration.taxId');
        if (taxIdControl) {
          const pattern = config.taxIdRegex || '^[A-Za-z0-9\\-\\s]+$';
          taxIdControl.setValidators([
            Validators.required,
            Validators.pattern(pattern),
          ]);
          taxIdControl.updateValueAndValidity();
        }

        const currencyControl = this.registerForm.get('configuration.currency');
        if (currencyControl) {
          currencyControl.setValue(config.currencyCode);
        }

        const fiscalRegionIdControl = this.registerForm.get('configuration.fiscalRegionId');
        if (fiscalRegionIdControl) {
          if (config.fiscalRegionId) {
            fiscalRegionIdControl.setValue(config.fiscalRegionId);
          } else {
            fiscalRegionIdControl.setValue(null);
          }
        }
      }
    });

    effect(() => {
      const code = this.countryService.currentCountryCode();
      if (code && this.registerForm) {
        const countryControl = this.registerForm.get('configuration.country');
        if (countryControl && countryControl.value !== code.toUpperCase()) {
          countryControl.setValue(code.toUpperCase(), { emitEvent: false });
        }
      }
    });
  }

  ngOnInit(): void {
    const routeCountry =
      this.activatedRoute.parent?.parent?.snapshot.paramMap.get('country') ||
      this.activatedRoute.parent?.snapshot.paramMap.get('country');

    if (!routeCountry) {
      this.countryService.detectAndSetCountry();
    }

    this.registerForm = this.fb.group({
      fax: [''],
      accountInfo: this.fb.group({
        firstName: ['', [Validators.required]],
        lastName: ['', [Validators.required]],
        email: ['', [Validators.required, Validators.email]],
        phone: ['', [Validators.required]],
        emailCode: [''],
        phoneCode: [''],
        passwordGroup: this.fb.group(
          {
            password: [
              '',
              [
                // H4 FIX: strongPasswordValidator() enforces the shared min length (12); the
                // redundant minLength(8) was removed so all forms share one source of truth.
                Validators.required,
                strongPasswordValidator(),
              ],
            ],
            confirmPassword: ['', [Validators.required]],
          },
          { validators: passwordMatchValidator },
        ),
      }),
      configuration: this.fb.group({
        country: ['DO', [Validators.required]],
        taxId: ['', [Validators.required]],
        fiscalRegionId: [null],
        currency: ['DOP', [Validators.required]],
      }),
      business: this.fb.group({
        companyName: ['', [Validators.required]],
        industry: ['', [Validators.required]],
        address: [''],
      }),
      plan: this.fb.group({
        selectedPlanId: ['starter', [Validators.required]],
        agreeToTerms: [false, [Validators.requiredTrue]],
      }),
    });

    this.activatedRoute.queryParams.subscribe((params) => {
      const emailToken = params['email_token'];
      if (emailToken) {
        this.handleEmailMagicLink(emailToken);
        return;
      }

      const socialRegistration = params['social_registration'];
      // H12 FIX: social register token is no longer a query param; backend reads it from the httpOnly cookie.
      if (socialRegistration === 'true') {
        this.authService.getSocialRegisterInfo().subscribe({
          next: (info) => {
            this.registerForm.patchValue({
              accountInfo: {
                firstName: info.firstName,
                lastName: info.lastName,
                email: info.email,
              },
            });
          },
        });
      }
    });
  }

  private handleEmailMagicLink(token: string) {
    this.authService.confirmEmailMagicLink(token).subscribe({
      next: (response) => {
        // H-08 FIX: The draft no longer stores PII — just clear the position marker.
        sessionStorage.removeItem(FORM_DRAFT_KEY);

        this.registerForm.get('accountInfo.emailCode')?.setValue(response.preVerifiedToken);
        this.emailVerified.set(true);

        this.stepsCompleted.update((c) => {
          const n = [...c];
          n[0] = true;
          n[1] = true;
          return n;
        });

        this.currentStep.set(3);
        this.errorMessage.set(null);

        this.router.navigate([], {
          relativeTo: this.activatedRoute,
          queryParams: {},
          replaceUrl: true,
        });
      },
      error: () => {
        this.errorMessage.set(
          'El enlace de confirmación ha expirado o no es válido. Por favor, ingresa el código manualmente.',
        );
        this.currentStep.set(2);
      },
    });
  }

  get accountInfo() {
    return this.registerForm.get('accountInfo') as FormGroup;
  }
  get business() {
    return this.registerForm.get('business') as FormGroup;
  }
  get configuration() {
    return this.registerForm.get('configuration') as FormGroup;
  }
  get plan() {
    return this.registerForm.get('plan') as FormGroup;
  }

  // Step → form group mapping (null for verification steps)
  private readonly stepFormMap: (string | null)[] = [
    'accountInfo',   // 1
    null,            // 2 — email verify
    null,            // 3 — phone verify
    'configuration', // 4
    'business',      // 5
    'plan',          // 6
  ];

  private getCurrentStepForm(): FormGroup | null {
    const key = this.stepFormMap[this.currentStep() - 1];
    return key ? (this.registerForm.get(key) as FormGroup) : null;
  }

  nextStep(): void {
    this.errorMessage.set(null);

    // Verification gate for email step
    if (this.currentStep() === 2 && !this.emailVerified()) {
      this.errorMessage.set('Debes verificar tu correo electrónico antes de continuar.');
      return;
    }

    // Verification gate for phone step
    if (this.currentStep() === 3 && !this.phoneVerified()) {
      this.errorMessage.set('Debes verificar tu número de celular antes de continuar.');
      return;
    }

    const currentForm = this.getCurrentStepForm();
    if (currentForm?.invalid) {
      currentForm.markAllAsTouched();
      this.errorMessage.set('Por favor, completa los campos requeridos correctamente.');
      return;
    }

    // Fiscal region validation for step 4 (configuration)
    if (this.currentStep() === 4) {
      const regionId = this.registerForm.get('configuration.fiscalRegionId')?.value;
      const currentCountry = this.countryService.currentCountryCode().toUpperCase();
      if (['DO', 'PA', 'US', 'CO'].includes(currentCountry) && !regionId) {
        this.errorMessage.set(
          'Error de configuración: No se ha cargado la región fiscal. Por favor recarga la página.',
        );
        return;
      }
    }

    // H-08 FIX: Do NOT store PII (name, email, phone) in sessionStorage.
    // sessionStorage is readable by any JS running in the same origin, making it
    // an XSS exfiltration target for PII (OWASP HTML5 Security Cheat Sheet;
    // GDPR data minimisation; CWE-922). Save only the step marker so the magic-
    // link callback can restore position without exposing personal data.
    if (this.currentStep() === 1) {
      sessionStorage.setItem(
        FORM_DRAFT_KEY,
        JSON.stringify({ step: this.currentStep(), savedAt: Date.now() }),
      );
    }

    this.stepsCompleted.update((completed) => {
      const n = [...completed];
      n[this.currentStep() - 1] = true;
      return n;
    });

    if (this.currentStep() < TOTAL_STEPS) {
      this.currentStep.update((s) => s + 1);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update((s) => s - 1);
      this.errorMessage.set(null);
    }
  }

  navigateToStep(stepIndex: number): void {
    if (stepIndex < this.currentStep() && this.stepsCompleted()[stepIndex - 1]) {
      this.currentStep.set(stepIndex);
      this.errorMessage.set(null);
    }
  }

  onEmailVerified(preVerifiedToken: string) {
    this.registerForm.get('accountInfo.emailCode')?.setValue(preVerifiedToken);
    this.emailVerified.set(true);
  }

  onPhoneVerified(preVerifiedToken: string) {
    this.registerForm.get('accountInfo.phoneCode')?.setValue(preVerifiedToken);
    this.phoneVerified.set(true);
  }

  onSubmit(): void {
    if (this.isRegistering()) return;

    this.isRegistering.set(true);
    this.errorMessage.set(null);

    const formValue = this.registerForm.getRawValue();

    this.recaptchaV3Service.execute('register').subscribe({
      next: (recaptchaToken) => {
        const regionId = formValue.configuration.fiscalRegionId;

        const payload: RegisterPayload = {
          firstName: formValue.accountInfo.firstName,
          lastName: formValue.accountInfo.lastName,
          email: formValue.accountInfo.email,
          emailVerificationCode: formValue.accountInfo.emailCode,
          phone: formValue.accountInfo.phone,
          phoneVerificationCode: formValue.accountInfo.phoneCode || undefined,
          password: formValue.accountInfo.passwordGroup.password,
          organizationName: formValue.business.companyName,
          taxId: formValue.configuration.taxId,
          fiscalRegionId: regionId && regionId !== '' ? regionId : undefined,
          recaptchaToken,
          industry: formValue.business.industry,
          address: formValue.business.address,
        } as any;

        this.authService.register(payload).subscribe({
          next: () => {
            const planId = formValue.plan.selectedPlanId;
            this.authService.createCheckoutSession(planId).subscribe({
              next: (response) => {
                this.isRegistering.set(false);
                sessionStorage.removeItem(FORM_DRAFT_KEY);
                if (response.url) {
                  window.location.href = response.url;
                } else {
                  this.router.navigate(['/dashboard']);
                }
              },
              error: () => {
                this.isRegistering.set(false);
                this.router.navigate(['/dashboard']);
              },
            });
          },
          error: (err) => {
            let msg = 'Error desconocido en el registro.';
            if (err.error?.message) {
              msg = Array.isArray(err.error.message)
                ? err.error.message.join(', ')
                : err.error.message;
            }
            this.errorMessage.set(msg);
            this.isRegistering.set(false);
          },
        });
      },
      error: () => {
        this.errorMessage.set('Error al validar seguridad (reCAPTCHA).');
        this.isRegistering.set(false);
      },
    });
  }
}
