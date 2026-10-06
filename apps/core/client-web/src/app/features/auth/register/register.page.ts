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
import { recaptchaToken$ } from '../../../core/auth/recaptcha-token';
import { environment } from '../../../../environments/environment';
import { CountryService } from '../../../core/services/country.service';
import {
  applyCountryConfig,
  buildConfigurationGroup,
  buildPlanGroup,
  companyPayload,
  onTaxpayerKindChanged,
} from './company-form';
import { GeoMismatchModalComponent } from '../../../shared/components/geo-mismatch-modal/geo-mismatch-modal.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { LanguageService } from '../../../core/services/language';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { NotificationService } from '../../../core/services/notification';

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
    AuthButtonComponent,
    ...VX_FORM_A11Y,
  ],
  providers: [
    ReCaptchaV3Service,
    { provide: RECAPTCHA_V3_SITE_KEY, useValue: environment.recaptcha.siteKey },
  ],
  templateUrl: './register.page.html',
  styleUrls: ['./register.page.scss'],
  animations: [
    //  El disparador va sobre el VISOR, que persiste entre pasos, y recibe el
    //  número de paso como valor. Antes estaba en el `div` de cada paso, que
    //  `*ngIf` destruía y volvía a crear: `:increment` compara el valor nuevo
    //  con el anterior DEL MISMO elemento, y un elemento recién creado no tiene
    //  anterior, así que ninguna de las dos transiciones llegó a ejecutarse
    //  nunca. La dirección del deslizamiento —hacia dónde va la vista— es
    //  justamente lo que le dice al usuario si avanza o retrocede.
    trigger('stepAnimation', [
      transition(':increment', [
        style({ transform: 'translateX(3%)', opacity: 0 }),
        animate(
          '280ms cubic-bezier(0, 0, 0, 1)',
          style({ transform: 'translateX(0)', opacity: 1 }),
        ),
      ]),
      transition(':decrement', [
        style({ transform: 'translateX(-3%)', opacity: 0 }),
        animate(
          '280ms cubic-bezier(0, 0, 0, 1)',
          style({ transform: 'translateX(0)', opacity: 1 }),
        ),
      ]),
    ]),
  ],
})
export class RegisterPage implements OnInit {
  /** Turns the API's error contract (`code`, `messageKey`, `params`) into the reader's sentence. */
  private readonly errorText = inject(NotificationService);
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
  /** A translation KEY for an error we raise ourselves (e.g. `register.errors.required_fields`). */
  errorMessage = signal<string | null>(null);
  /**
   * A message the SERVER already localized (it honours Accept-Language). Shown verbatim, never
   * through `translate`: a full sentence is not a known key, so the missing-translation handler
   * would either wrap it in `[[…]]` (dev) or humanise it to its last dotted segment — an empty
   * string for a sentence ending in "." — leaving the user staring at a blank error box.
   */
  serverErrorMessage = signal<string | null>(null);
  isRegistering = signal(false);
  stepsCompleted = signal<boolean[]>(new Array(TOTAL_STEPS).fill(false));

  emailVerified = signal(false);
  phoneVerified = signal(false);
  /** The SMS channel is down, so the phone step stops being a gate. See `StepPhoneVerify.unavailable`. */
  phoneChannelDown = signal(false);

  readonly steps = Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1);

  /**
   * Rótulos del riel de progreso, en el orden de los pasos.
   *
   * Un asistente de seis pasos numerados no dice nada: «vas por el 4 de 6» no
   * es información, porque el usuario no sabe qué le espera en el 5 ni en el 6.
   * Con el rótulo puesto, el riel se convierte además en un índice del alta.
   */
  readonly stepLabelKeys = [
    'register.progress.account',
    'register.progress.email',
    'register.progress.phone',
    'register.progress.fiscal',
    'register.progress.business',
    'register.progress.plan',
  ];

  currentCountryConfig = computed(() => this.countryService.currentCountry());

  get currentEmail(): string {
    return this.registerForm?.get('accountInfo.email')?.value ?? '';
  }

  /**
   * The name and country the wizard already holds, for the verification email.
   *
   * Both are collected before the email step: the name on step 1, the country by the country
   * selector. The verification email was sent with neither, so it greeted "Hola Usuario" and its
   * magic link always pointed at `/es/do/…`.
   */
  get currentFirstName(): string {
    return this.registerForm?.get('accountInfo.firstName')?.value ?? '';
  }

  get currentCountry(): string {
    return this.countryService.currentCountry()?.countryCode ?? '';
  }

  get currentPhone(): string {
    return this.registerForm?.get('accountInfo.phone')?.value ?? '';
  }

  constructor() {
    /**
     * Re-shape the fiscal fields whenever the country changes.
     *
     * The previous version fell back to `'^[A-Za-z0-9\\-\\s]+$'` when the country carried no
     * pattern — and the country service supplied `'.*'` on any load failure — so a network hiccup
     * silently disabled tax-id validation and the user was told their input was fine until the
     * server rejected it. There is no fallback pattern now: the country's own pattern applies, and
     * when no country is loaded the fields carry only `required`, which cannot pass silently.
     */
    effect(() => {
      const config = this.currentCountryConfig();
      if (!config || !this.registerForm) return;
      applyCountryConfig(this.registerForm.get('configuration') as FormGroup, config, this.fb);
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
      accountInfo: this.fb.group({
        firstName: ['', [Validators.required]],
        lastName: ['', [Validators.required]],
        email: ['', [Validators.required, Validators.email]],
        // Optional, matching the server. It was required here while the DTO marked it optional,
        // and the wizard additionally blocked progress on an SMS verification — mandatory SMS at
        // signup is real friction for corporate buyers and an SMS-pumping surface. A second
        // factor is enrolled later, from the security settings, by whoever wants one.
        phone: [''],
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
      configuration: buildConfigurationGroup(this.fb),
      business: this.fb.group({
        companyName: ['', [Validators.required]],
        industry: ['', [Validators.required]],
        companySize: [''],
        // Honeypot. It lives in THIS group because that is the one `StepBusiness` renders — it
        // used to sit at the root of the form, where no template referenced it, so it was never
        // shown to a bot and never submitted. A honeypot that is not in the payload is not a
        // honeypot; the server's entire spam branch was unreachable from the product.
        fax: [''],
      }),
      plan: buildPlanGroup(this.fb),
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

  /** Rebuild the fiscal fields when the taxpayer kind changes, not only when the country does. */
  onTaxpayerKindChange(): void {
    onTaxpayerKindChanged(this.registerForm.get('configuration') as FormGroup, this.currentCountryConfig(), this.fb);
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
        this.clearError();

        this.router.navigate([], {
          relativeTo: this.activatedRoute,
          queryParams: {},
          replaceUrl: true,
        });
      },
      error: () => {
        this.errorMessage.set('register.errors.confirmation_link_has_expired_isn_valid');
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

  /** Clear both the key-based error and any verbatim server message. */
  private clearError(): void {
    this.errorMessage.set(null);
    this.serverErrorMessage.set(null);
  }

  nextStep(): void {
    this.clearError();

    // Verification gate for email step
    if (this.currentStep() === 2 && !this.emailVerified()) {
      this.errorMessage.set('register.errors.email_verify_required');
      return;
    }

    // Verification gate for phone step — only when a number was actually given AND the SMS channel
    // is actually working. The phone is optional; demanding an SMS for an empty field made the step
    // impossible to pass, and demanding one the server cannot send made the whole signup
    // impossible on any deployment without an SMS provider.
    if (
      this.currentStep() === 3 &&
      this.currentPhone &&
      !this.phoneVerified() &&
      !this.phoneChannelDown()
    ) {
      this.errorMessage.set('register.errors.phone_verify_required');
      return;
    }

    const currentForm = this.getCurrentStepForm();
    if (currentForm?.invalid) {
      currentForm.markAllAsTouched();
      this.errorMessage.set('register.errors.required_fields');
      return;
    }

    // The country is the authoritative fiscal field, not the fiscal region.
    //
    // The server derives the region, chart of accounts and taxes from `countryCode` and
    // deliberately IGNORES any `fiscalRegionId` the client sends (it is accepted only for
    // backwards compatibility). Gating on `fiscalRegionId` therefore checked a value the backend
    // no longer reads — and one that is null whenever the country catalogue does not carry it —
    // so a user could fill in a fully valid, supported country and still be blocked here. The gate
    // now verifies what actually matters: a country is chosen and its configuration has loaded.
    if (
      this.currentStep() === 4 &&
      (!this.registerForm.get('configuration.country')?.value || !this.currentCountryConfig())
    ) {
      this.errorMessage.set('register.errors.we_couldn_load_tax_settings_country');
      return;
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
      this.clearError();
    }
  }

  navigateToStep(stepIndex: number): void {
    if (stepIndex < this.currentStep() && this.stepsCompleted()[stepIndex - 1]) {
      this.currentStep.set(stepIndex);
      this.clearError();
    }
  }

  onEmailVerified(preVerifiedToken: string) {
    this.registerForm.get('accountInfo.emailCode')?.setValue(preVerifiedToken);
    this.emailVerified.set(true);
    // Auto-advance: a verified email leaves nothing else to do on this step, so
    // move the user forward automatically (no manual "Next" click needed). The
    // OTP component already shows its success state briefly before emitting.
    if (this.currentStep() === 2) {
      this.nextStep();
    }
  }

  onPhoneVerified(preVerifiedToken: string) {
    this.registerForm.get('accountInfo.phoneCode')?.setValue(preVerifiedToken);
    this.phoneVerified.set(true);
    // Auto-advance once the phone number is verified — same rationale as email.
    if (this.currentStep() === 3) {
      this.nextStep();
    }
  }

  onSubmit(): void {
    if (this.isRegistering()) return;

    this.isRegistering.set(true);
    this.clearError();

    const formValue = this.registerForm.getRawValue();

    recaptchaToken$(this.recaptchaV3Service, 'register').subscribe({
      next: (recaptchaToken) => {
        const payload: RegisterPayload & { planId: string; billingPeriod: string } = {
          firstName: formValue.accountInfo.firstName,
          lastName: formValue.accountInfo.lastName,
          email: formValue.accountInfo.email,
          emailVerificationCode: formValue.accountInfo.emailCode,
          phone: formValue.accountInfo.phone || undefined,
          phoneVerificationCode: formValue.accountInfo.phoneCode || undefined,
          password: formValue.accountInfo.passwordGroup.password,
          ...companyPayload(formValue),
          recaptchaToken,
          // Sent only when a bot filled it. The server answers a honeypot hit with a believable
          // success and no session, so the payload has to carry the field for that to ever run.
          fax: formValue.business.fax || undefined,
        };

        // Payment-first: the backend validates and returns a Stripe Checkout URL.
        // The account is only created after payment succeeds (see checkout-complete).
        this.authService.registerCheckout(payload).subscribe({
          next: (response) => {
            this.isRegistering.set(false);
            sessionStorage.removeItem(FORM_DRAFT_KEY);
            if (response.url) {
              window.location.href = response.url;
            } else {
              // Honeypot / no checkout needed — send to login without leaking why.
              this.router.navigate(['/auth/login']);
            }
          },
          error: (err) => {
            // The server's message is already localized, so it is shown verbatim (see
            // `serverErrorMessage`) — this is what surfaces a rejected RNC/RFC/NIT etc. to the
            // user. Only our own fallback is a translation key.
            // The API sends `messageKey` and `params`, never a `message`: reading `message` meant a
            // rejected RNC/RFC/NIT always showed «unknown error». Resolved into a sentence here.
            this.serverErrorMessage.set(this.errorText.httpErrorMessage(err, 'register.errors.unknown'));
            this.isRegistering.set(false);
          },
        });
      },
      error: () => {
        this.errorMessage.set('register.errors.recaptcha');
        this.isRegistering.set(false);
      },
    });
  }
}
