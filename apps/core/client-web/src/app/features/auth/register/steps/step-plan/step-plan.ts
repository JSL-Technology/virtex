import { Component, Input, effect, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormGroup } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { LucideAngularModule, Rocket, Check, AlertCircle } from 'lucide-angular';
import { BillingService } from '../../../../../core/services/billing';
import { annualSavingPercent, formatPlanPrice, type BillingPeriod } from '../../../../../core/models/plan.model';
import { CountryService } from '../../../../../core/services/country.service';
import { LanguageService } from '../../../../../core/services/language';

/** One bullet on a plan card: either a translation key with params, or literal server text. */
export interface PlanFeatureLine {
  key: string | null;
  text: string;
  params?: Record<string, unknown>;
}

interface DisplayPlan {
  id: string; // slug
  name: string;
  price: string;
  period: string;
  /** Present only when the plan can actually be billed annually. */
  annualPrice: string | null;
  annualSaving: number | null;
  features: PlanFeatureLine[];
  recommended: boolean;
}

@Component({
  selector: 'app-step-plan',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    TranslateModule,
    RouterModule,
    LucideAngularModule
  ],
  templateUrl: './step-plan.html',
  styleUrls: ['./step-plan.scss']
})
export class StepPlan {
  @Input() group!: FormGroup;

  readonly RocketIcon = Rocket;
  readonly CheckIcon = Check;
  readonly AlertCircleIcon = AlertCircle;

  private billingService = inject(BillingService);
  private countryService = inject(CountryService);
  private languageService = inject(LanguageService);

  constructor() {
    // Re-quote whenever the market changes. The catalogue is priced per country, so a plan card
    // rendered before the country was chosen is a price for a different market.
    effect(() => {
      const code = this.countryService.currentCountry()?.countryCode;
      if (code) this.billingService.loadPlans(code);
    });
  }

  /** Real plans from the backend so prices/limits stay in sync with billing. */
  plans = computed<DisplayPlan[]>(() => {
    const list = this.billingService.plans();
    // "pro" is highlighted as recommended when present; otherwise the middle one.
    return list.map((p, i) => ({
      id: p.slug,
      name: p.name,
      // Formatted from the currency the server quoted, in the user's locale. It used to be
      // `$` + amount/100 regardless of market, so a Colombian saw "$49" and was billed in pesos,
      // and a Chilean price would have been shown a hundred times too small.
      price: formatPlanPrice(p, this.localeFor(p.currency), this.billingPeriod()),
      period:
        this.billingPeriod() === 'annual'
          ? 'REGISTER.STEPS.PLAN.PER_YEAR'
          : 'REGISTER.STEPS.PLAN.PER_MONTH',
      annualPrice: p.annualBillingAvailable
        ? formatPlanPrice(p, this.localeFor(p.currency), 'annual')
        : null,
      annualSaving: annualSavingPercent(p),
      features: this.buildFeatures(p),
      recommended: p.slug === 'pro' || (list.length === 3 && i === 1 && !list.some(x => x.slug === 'pro')),
    }));
  });

  plansState = this.billingService.plansState;

  /** BCP 47 tag for formatting: the country's own locale where known, else the UI language. */
  private localeFor(currency: string): string {
    const config = this.countryService.currentCountry();
    if (config?.currency === currency && config.locale) return config.locale;
    return this.languageService.currentLang() ?? 'es';
  }

  /**
   * The bullet list on a plan card, translated.
   *
   * This used to build strings by hand: `limit.resource.replace('_', ' ')` produced the raw enum
   * name (`journal entries`) and the quantifiers were hardcoded Spanish — including `ilimitad@s`,
   * which is neither a word nor translatable — on a product sold in the United States. Everything
   * now goes through the same translation catalogue as the rest of the page.
   */
  private buildFeatures(p: {
    description?: string;
    limits?: { resource: string; limit: number; period: string }[];
  }): PlanFeatureLine[] {
    const lines: PlanFeatureLine[] = [];
    if (p.description) lines.push({ key: null, text: p.description });

    for (const limit of p.limits ?? []) {
      const resource = `REGISTER.STEPS.PLAN.RESOURCES.${limit.resource.toUpperCase()}`;
      lines.push({
        key:
          limit.limit === -1
            ? 'REGISTER.STEPS.PLAN.UNLIMITED'
            : limit.period === 'monthly'
              ? 'REGISTER.STEPS.PLAN.PER_PERIOD_MONTH'
              : 'REGISTER.STEPS.PLAN.TOTAL',
        text: '',
        params: { count: limit.limit, resource },
      });
    }
    return lines;
  }

  retry(): void {
    this.billingService.loadPlans();
  }

  selectPlan(planId: string) {
    this.group.patchValue({ selectedPlanId: planId });
  }

  isSelected(planId: string) {
    return this.group.get('selectedPlanId')?.value === planId;
  }

  /**
   * Whether annual billing can be offered at all.
   *
   * Only when EVERY plan has it: a toggle that silently changes what some cards mean is worse
   * than no toggle, and the server refuses a period a plan has no Stripe Price for.
   */
  readonly annualAvailable = computed(
    () =>
      this.billingService.plans().length > 0 &&
      this.billingService.plans().every((p) => p.annualBillingAvailable),
  );

  /**
   * Read as a getter, not a `computed`: `group` is a plain `@Input`, not a signal, so a computed
   * over it would capture the first value and never recompute.
   */
  billingPeriod(): BillingPeriod {
    return (this.group?.get('billingPeriod')?.value as BillingPeriod) ?? 'monthly';
  }

  setBillingPeriod(period: BillingPeriod): void {
    this.group.patchValue({ billingPeriod: period });
  }
}
