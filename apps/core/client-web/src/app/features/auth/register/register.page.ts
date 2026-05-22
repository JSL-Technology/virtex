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

// Validador personalizado para coincidencia de contraseñas
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
  // Iconos
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
  stepsCompleted = signal<boolean[]>(new Array(4).fill(false));

  // Configuración reactiva basada en el país
  currentCountryConfig = computed(() => this.countryService.currentCountry());

  constructor() {
    // 1. Efecto: Actualizar validadores y valores cuando cambia la configuración del país
    effect(() => {
      const config = this.currentCountryConfig();
      if (config && this.registerForm) {
        console.log('[Register] Aplicando configuración de país:', config.code);

        // Actualizar Regex del Tax ID (RNC/NIT/EIN)
        const taxIdControl = this.registerForm.get('configuration.taxId');
        if (taxIdControl) {
          // Usamos el regex que viene del backend o uno permisivo por defecto
          const pattern = config.taxIdRegex || '^[A-Za-z0-9\\-\\s]+$';
          taxIdControl.setValidators([
            Validators.required,
            Validators.pattern(pattern),
          ]);
          taxIdControl.updateValueAndValidity();
        }

        // Actualizar Moneda
        const currencyControl = this.registerForm.get('configuration.currency');
        if (currencyControl) {
          currencyControl.setValue(config.currencyCode);
        }

        // Actualizar Región Fiscal (SOLO si el backend envió un ID válido)
        const fiscalRegionIdControl = this.registerForm.get(
          'configuration.fiscalRegionId',
        );
        if (fiscalRegionIdControl) {
          if (config.fiscalRegionId) {
            fiscalRegionIdControl.setValue(config.fiscalRegionId);
          } else {
            // Si no hay región fiscal (ej. país no soportado completamente), limpiar
            fiscalRegionIdControl.setValue(null);
          }
        }
      }
    });

    // 2. Efecto: Sincronizar el dropdown de país en el formulario
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
    // Check if we have a country in the route
    const routeCountry = this.activatedRoute.parent?.parent?.snapshot.paramMap.get('country') ||
                         this.activatedRoute.parent?.snapshot.paramMap.get('country');

    if (!routeCountry) {
      // Iniciar detección de país only if not in a country-specific route
      this.countryService.detectAndSetCountry();
    }

    this.registerForm = this.fb.group({
      fax: [''], // Honeypot antispam
      // Paso 1: Información de Cuenta
      accountInfo: this.fb.group({
        firstName: ['', [Validators.required]],
        lastName: ['', [Validators.required]],
        email: ['', [Validators.required, Validators.email]],
        jobTitle: [''],
        phone: [''],
        avatarUrl: [null],
        passwordGroup: this.fb.group(
          {
            password: [
              '',
              [
                Validators.required,
                Validators.minLength(8),
                strongPasswordValidator(),
              ],
            ],
            confirmPassword: ['', [Validators.required]],
          },
          { validators: passwordMatchValidator },
        ),
      }),
      // Paso 2: Configuración Fiscal (Dinámica)
      configuration: this.fb.group({
        country: ['DO', [Validators.required]],
        taxId: ['', [Validators.required]],
        fiscalRegionId: [null], // Se llena automáticamente vía Effect
        currency: ['DOP', [Validators.required]],
      }),
      // Paso 3: Perfil de Negocio
      business: this.fb.group({
        companyName: ['', [Validators.required]],
        industry: ['', [Validators.required]],
        numberOfEmployees: ['', [Validators.required]],
        address: [''],
        website: [''],
        logoFile: [null],
      }),
      // Paso 4: Términos
      plan: this.fb.group({
        agreeToTerms: [false, [Validators.requiredTrue]],
      }),
    });

    // Manejo de tokens de invitación/social
    this.activatedRoute.queryParams.subscribe((params) => {
      const token = params['token'];
      const socialRegistration = params['social_registration'];
      if (token || socialRegistration === 'true') {
        const tokenToUse = token || '';
        this.authService.getSocialRegisterInfo(tokenToUse).subscribe({
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

  // Getters para el template
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

  private getCurrentStepForm(): FormGroup | null {
    const stepNames = ['accountInfo', 'configuration', 'business', 'plan'];
    return this.registerForm.get(
      stepNames[this.currentStep() - 1],
    ) as FormGroup;
  }

  nextStep(): void {
    const currentForm = this.getCurrentStepForm();
    if (currentForm?.invalid) {
      currentForm.markAllAsTouched();
      this.errorMessage.set(
        'Por favor, completa los campos requeridos correctamente.',
      );
      return;
    }

    // Validación específica antes de pasar del paso 2 (Config)
    if (this.currentStep() === 2) {
      const regionId = this.registerForm.get(
        'configuration.fiscalRegionId',
      )?.value;
      const currentCountry = this.countryService
        .currentCountryCode()
        .toUpperCase();

      // Si estamos en DO/PA/US, DEBE haber una región fiscal cargada.
      if (['DO', 'PA', 'US', 'CO'].includes(currentCountry) && !regionId) {
        this.errorMessage.set(
          'Error de configuración: No se ha cargado la región fiscal. Por favor recarga la página o verifica tu conexión.',
        );
        return;
      }
    }

    this.stepsCompleted.update((completed) => {
      const newCompleted = [...completed];
      newCompleted[this.currentStep() - 1] = true;
      return newCompleted;
    });

    if (this.currentStep() < 4) {
      this.currentStep.update((step) => step + 1);
      this.errorMessage.set(null);
    }
  }

  prevStep(): void {
    if (this.currentStep() > 1) {
      this.currentStep.update((step) => step - 1);
    }
  }

  navigateToStep(stepIndex: number): void {
    if (
      stepIndex < this.currentStep() &&
      this.stepsCompleted()[stepIndex - 1]
    ) {
      this.currentStep.set(stepIndex);
    }
  }

  onSubmit(): void {
    if (this.isRegistering()) return;

    this.isRegistering.set(true);
    this.errorMessage.set(null);

    const formValue = this.registerForm.getRawValue();

    this.recaptchaV3Service.execute('register').subscribe({
      next: (recaptchaToken) => {
        // Limpieza final de datos
        const regionId = formValue.configuration.fiscalRegionId;

        const payload: RegisterPayload = {
          firstName: formValue.accountInfo.firstName,
          lastName: formValue.accountInfo.lastName,
          email: formValue.accountInfo.email,
          password: formValue.accountInfo.passwordGroup.password,
          organizationName: formValue.business.companyName,
          // Datos fiscales
          taxId: formValue.configuration.taxId,
          // Solo enviar fiscalRegionId si tiene valor real, sino undefined
          fiscalRegionId: regionId && regionId !== '' ? regionId : undefined,

          recaptchaToken,

          // Datos de perfilado
          industry: formValue.business.industry,
          companySize: formValue.business.numberOfEmployees,
          address: formValue.business.address,
        };

        this.authService.register(payload).subscribe({
          next: () => {
            this.isRegistering.set(false);
            this.router.navigate(['/auth/plan-selection']);
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
