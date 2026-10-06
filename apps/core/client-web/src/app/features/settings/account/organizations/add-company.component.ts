import { ChangeDetectionStrategy, Component, computed, effect, inject, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../../../core/services/auth';
import { CountryService } from '../../../../core/services/country.service';
import { NotificationService } from '../../../../core/services/notification';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { StepConfiguration } from '../../../auth/register/steps/step-configuration/step-configuration';
import { StepBusiness } from '../../../auth/register/steps/step-business/step-business';
import { StepPlan } from '../../../auth/register/steps/step-plan/step-plan';
import {
  applyCountryConfig,
  buildConfigurationGroup,
  buildPlanGroup,
  companyPayload,
  onTaxpayerKindChanged,
} from '../../../auth/register/company-form';

type Step = 'configuration' | 'business' | 'plan';
const STEPS: readonly Step[] = ['configuration', 'business', 'plan'];

/**
 * «Add a company» for someone already signed in: an independent company with its own subscription.
 *
 * The same three company steps as the public signup — fiscal configuration, business, plan — over
 * the same shared form logic (`company-form.ts`), so a company is described and validated the
 * same way through either door. What is missing is on purpose: name, email, password and the
 * verification codes describe the PERSON, and the session already proves who that is.
 *
 * Nothing is created here. The server stores a pending company and answers with Stripe Checkout;
 * the company exists once the payment is confirmed, and the confirmation page then opens it.
 */
@Component({
  selector: 'app-add-company',
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, StepConfiguration, StepBusiness, StepPlan],
  templateUrl: './add-company.component.html',
  styleUrls: ['./add-company.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AddCompanyComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly countries = inject(CountryService);
  private readonly notifications = inject(NotificationService);
  private readonly tenancy = inject(ActiveOrganizationService);

  readonly cancelled = output<void>();

  protected readonly steps: readonly { id: Step; labelKey: string }[] = [
    { id: 'configuration', labelKey: 'settings.my_companies.step_configuration' },
    { id: 'business', labelKey: 'settings.my_companies.step_business' },
    { id: 'plan', labelKey: 'settings.my_companies.step_plan' },
  ];
  readonly step = signal<Step>('configuration');
  readonly submitting = signal(false);
  readonly serverError = signal<string | null>(null);
  protected readonly stepIndex = computed(() => STEPS.indexOf(this.step()));

  readonly configuration: FormGroup = buildConfigurationGroup(this.fb);
  readonly business: FormGroup = this.fb.group({
    companyName: ['', [Validators.required]],
    industry: ['', [Validators.required]],
    companySize: [''],
    // Rendered by the shared business step as a honeypot. A signed-in person is not a bot; the
    // control exists so the step renders, and its value is never sent.
    fax: [''],
  });
  readonly plan: FormGroup = buildPlanGroup(this.fb);

  constructor() {
    // Start from the country of the company the person is in: the likeliest market for the next.
    const home = this.tenancy.organization()?.countryCode;
    this.countries.getCountryConfig(home || 'DO').subscribe({ error: () => undefined });

    effect(() => {
      const config = this.countries.currentCountry();
      if (config) applyCountryConfig(this.configuration, config, this.fb);
    });
  }

  onTaxpayerKindChange(): void {
    onTaxpayerKindChanged(this.configuration, this.countries.currentCountry(), this.fb);
  }

  private groupFor(step: Step): FormGroup {
    return step === 'configuration' ? this.configuration : step === 'business' ? this.business : this.plan;
  }

  next(): void {
    const group = this.groupFor(this.step());
    // A country whose rules did not load is not one a company can be validated under.
    if (this.step() === 'configuration' && !this.countries.currentCountry()) {
      this.serverError.set(this.notifications.httpErrorMessage(null, 'settings.my_companies.country_not_loaded'));
      return;
    }
    if (group.invalid) {
      group.markAllAsTouched();
      return;
    }
    this.serverError.set(null);
    const index = this.stepIndex();
    if (index < STEPS.length - 1) this.step.set(STEPS[index + 1]);
    else this.submit();
  }

  back(): void {
    const index = this.stepIndex();
    if (index === 0) this.cancelled.emit();
    else this.step.set(STEPS[index - 1]);
  }

  private submit(): void {
    if (this.submitting()) return;
    this.submitting.set(true);
    const payload = companyPayload({
      configuration: this.configuration.getRawValue(),
      business: this.business.getRawValue(),
      plan: this.plan.getRawValue(),
    });
    this.auth.addCompanyCheckout(payload).subscribe({
      next: (response) => {
        if (response.url) {
          window.location.href = response.url;
          return;
        }
        this.submitting.set(false);
        this.serverError.set(this.notifications.httpErrorMessage(null, 'settings.my_companies.checkout_failed'));
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        // A rejected tax id, an already-registered company, a plan not sold in that market: the
        // server's own reason, in the reader's language.
        this.serverError.set(this.notifications.httpErrorMessage(error, 'settings.my_companies.checkout_failed'));
      },
    });
  }
}
