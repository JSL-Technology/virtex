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
import {
  CountryService,
  type FiscalFieldSpec,
  type TaxpayerKind,
} from '../../../core/services/country.service';
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
    AuthLayoutComponent,
    AuthButtonComponent,
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

  /**
   * Rótulos del riel de progreso, en el orden de los pasos.
   *
   * Un asistente de seis pasos numerados no dice nada: «vas por el 4 de 6» no
   * es información, porque el usuario no sabe qué le espera en el 5 ni en el 6.
   * Con el rótulo puesto, el riel se convierte además en un índice del alta.
   */
  readonly stepLabelKeys = [
    'REGISTER.PROGRESS.ACCOUNT',
    'REGISTER.PROGRESS.EMAIL',
    'REGISTER.PROGRESS.PHONE',
    'REGISTER.PROGRESS.FISCAL',
    'REGISTER.PROGRESS.BUSINESS',
    'REGISTER.PROGRESS.PLAN',
  ];

  currentCountryConfig = computed(() => this.countryService.currentCountry());

  get currentEmail(): string {
    return this.registerForm?.get('accountInfo.email')?.value ?? '';
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

      const taxIdControl = this.registerForm.get('configuration.taxId');
      taxIdControl?.setValidators([Validators.required, Validators.pattern(config.taxIdPattern)]);
      taxIdControl?.updateValueAndValidity({ emitEvent: false });

      // The postal code is required only where the country requires it — United States sales tax
      // is destination-based and cannot be computed without a ZIP, whereas most of Latin America
      // does not use postal codes on fiscal documents at all.
      const postalCodeControl = this.registerForm.get('configuration.postalCode');
      const postalValidators = config.address.postalCodeRequired ? [Validators.required] : [];
      if (config.address.postalCodePattern) {
        postalValidators.push(Validators.pattern(config.address.postalCodePattern));
      }
      postalCodeControl?.setValidators(postalValidators);
      postalCodeControl?.updateValueAndValidity({ emitEvent: false });

      // Switching country invalidates a division code from the previous country's catalogue.
      const stateControl = this.registerForm.get('configuration.state');
      if (config.address.divisions && stateControl?.value) {
        const stillValid = config.address.divisions.some((d) => d.code === stateControl.value);
        if (!stillValid) stateControl.setValue('', { emitEvent: false });
      }

      this.syncFiscalFields(config);

      this.registerForm.get('configuration.currency')?.setValue(config.currency, { emitEvent: false });
      this.registerForm
        .get('configuration.fiscalRegionId')
        ?.setValue(config.fiscalRegionId ?? null, { emitEvent: false });
      this.registerForm
        .get('configuration.country')
        ?.setValue(config.countryCode, { emitEvent: false });
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
      configuration: this.fb.group({
        country: ['DO', [Validators.required]],
        // Company or natural person. Nine of the nineteen markets issue a different fiscal
        // identifier to each, or encode the distinction inside one, and it also selects which
        // régimen fiscal options the SAT catalogue offers — so it has to be answered before the
        // tax id can be validated at all.
        taxpayerKind: ['company', [Validators.required]],
        taxId: ['', [Validators.required]],
        fiscalRegionId: [null],
        currency: ['DOP', [Validators.required]],
        // Country-specific fiscal answers, added and removed by the effect below as the country
        // or the taxpayer kind changes. Declared as an empty group rather than a fixed set,
        // because which controls exist is a property of the country.
        fiscalProfile: this.fb.group({}),
        // The fiscal address. Structured, and collected here rather than as one free-text line on
        // the next step: every electronic-invoicing regime in these markets stamps these fields
        // individually, so a single line would have to be re-collected before invoicing can work.
        address: ['', [Validators.required]],
        city: ['', [Validators.required]],
        state: ['', [Validators.required]],
        postalCode: [''],
      }),
      business: this.fb.group({
        companyName: ['', [Validators.required]],
        industry: ['', [Validators.required]],
        companySize: [''],
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

  /**
   * Rebuild the country's extra fiscal controls.
   *
   * Which fields exist depends on the country AND on whether the taxpayer is a company or a
   * natural person — a Mexican persona moral picks from a different `RegimenFiscal` list than a
   * persona física. Rather than hardcode a branch per country, the server publishes the specs and
   * this rebuilds the group from them, so opening a market changes one list on the backend.
   *
   * Existing answers are carried over when the field survives the change, so switching taxpayer
   * kind does not silently wipe an address the user already typed.
   */
  private syncFiscalFields(config: { fiscalFields?: FiscalFieldSpec[] } | null): void {
    const group = this.registerForm.get('configuration.fiscalProfile') as FormGroup | null;
    if (!group) return;

    const kind = this.registerForm.get('configuration.taxpayerKind')?.value as
      | TaxpayerKind
      | undefined;
    const specs = (config?.fiscalFields ?? []).filter(
      (field) => !field.appliesTo || !kind || field.appliesTo.includes(kind),
    );
    const wanted = new Set(specs.map((field) => field.key));

    for (const existing of Object.keys(group.controls)) {
      if (!wanted.has(existing)) group.removeControl(existing, { emitEvent: false });
    }

    for (const field of specs) {
      const validators = field.required ? [Validators.required] : [];
      if (field.type === 'text' && field.pattern) {
        validators.push(Validators.pattern(field.pattern));
      }
      const current = group.get(field.key);
      if (current) {
        // A select whose option list no longer contains the chosen code must not keep it.
        if (field.type === 'select' && current.value) {
          const allowed = (field.options ?? []).filter(
            (option) => !option.appliesTo || !kind || option.appliesTo.includes(kind),
          );
          if (!allowed.some((option) => option.code === current.value)) {
            current.setValue('', { emitEvent: false });
          }
        }
        current.setValidators(validators);
        current.updateValueAndValidity({ emitEvent: false });
      } else {
        group.addControl(field.key, this.fb.control('', validators), { emitEvent: false });
      }
    }
  }

  /** Rebuild the fiscal fields when the taxpayer kind changes, not only when the country does. */
  onTaxpayerKindChange(): void {
    this.syncFiscalFields(this.currentCountryConfig());
    // The tax id was validated against the other scheme; re-checking it now tells the user
    // immediately rather than after they reach the plan step.
    this.registerForm.get('configuration.taxId')?.updateValueAndValidity();
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

    // Verification gate for phone step — only when a number was actually given. The phone is
    // optional; demanding an SMS for an empty field made the step impossible to pass.
    if (this.currentStep() === 3 && this.currentPhone && !this.phoneVerified()) {
      this.errorMessage.set('Debes verificar tu número de celular antes de continuar.');
      return;
    }

    const currentForm = this.getCurrentStepForm();
    if (currentForm?.invalid) {
      currentForm.markAllAsTouched();
      this.errorMessage.set('Por favor, completa los campos requeridos correctamente.');
      return;
    }

    // Every country needs a fiscal region, not just four of them.
    //
    // This used to check `['DO', 'PA', 'US', 'CO']`, so choosing any other country — including the
    // four others the form offered — passed the gate with no region and produced a tenant with no
    // chart of accounts and no taxes. The region is now required for whatever country is selected,
    // which is the only version of this check that means anything.
    if (this.currentStep() === 4 && !this.registerForm.get('configuration.fiscalRegionId')?.value) {
      this.errorMessage.set(
        'No se pudo cargar la configuración fiscal de ese país. Recarga la página o elige otro país.',
      );
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
    this.errorMessage.set(null);

    const formValue = this.registerForm.getRawValue();

    this.recaptchaV3Service.execute('register').subscribe({
      next: (recaptchaToken) => {
        const payload: RegisterPayload & { planId: string } = {
          firstName: formValue.accountInfo.firstName,
          lastName: formValue.accountInfo.lastName,
          email: formValue.accountInfo.email,
          emailVerificationCode: formValue.accountInfo.emailCode,
          phone: formValue.accountInfo.phone || undefined,
          phoneVerificationCode: formValue.accountInfo.phoneCode || undefined,
          password: formValue.accountInfo.passwordGroup.password,
          organizationName: formValue.business.companyName,
          // The country is now the authoritative fiscal field. The server resolves the region from
          // it and ignores any region id the client supplies, so a payload cannot be validated
          // under one country's rules and provisioned under another's.
          countryCode: formValue.configuration.country,
          taxpayerKind: formValue.configuration.taxpayerKind,
          taxId: formValue.configuration.taxId,
          fiscalProfile: formValue.configuration.fiscalProfile ?? {},
          recaptchaToken,
          industry: formValue.business.industry,
          companySize: formValue.business.companySize || undefined,
          address: formValue.configuration.address,
          city: formValue.configuration.city,
          state: formValue.configuration.state,
          postalCode: formValue.configuration.postalCode || undefined,
          planId: formValue.plan.selectedPlanId,
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
